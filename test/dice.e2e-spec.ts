import { fundTestWallet } from './fund-wallet.js'
import { RevealDto } from '../src/dice/dto.js'
import { DiceEntry } from '../src/dice/models.js'
import { payout, DiceRandom } from '../src/dice/math.js'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Sequelize } from 'sequelize-typescript'
import { QueryTypes } from 'sequelize'
import { createHash, randomUUID } from 'node:crypto'
import { io, type Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module.js'
import { AuthService } from '../src/auth/auth.service.js'
import { DiceService } from '../src/dice/dice.service.js'
import type { DiceReply, DiceState } from '../src/dice/contracts.js'

describe('Dice PostgreSQL + real WebSocket', () => {
  let app: NestExpressApplication

  let db: Sequelize

  let auth: AuthService

  let dice: DiceService

  let url: string

  const sockets: Socket[] = []

  const origin = 'http://127.0.0.1:3100'

  async function boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DiceRandom)
      .useValue({ field: (mines: number) => (1 << mines) - 1 })
      .compile()

    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    })
    await app.listen(0, '127.0.0.1')

    const address = app.getHttpServer().address()

    if (!address || typeof address === 'string') {
      throw new Error('No address')
    }

    url = 'http://127.0.0.1:' + address.port
    db = app.get(Sequelize)
    auth = app.get(AuthService)
    dice = app.get(DiceService)
    await db.query('DELETE FROM dice_limits WHERE key = :key', {
      replacements: { key: createHash('sha256').update('handshake:127.0.0.1').digest('hex') },
    })
  }

  beforeAll(boot, 30000)
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect())
    await app?.close()
  })

  async function open(token: string, requestOrigin = origin) {
    const { ticket } = await dice.ticket(token)

    const s = io(url + '/dice', {
      transports: ['websocket'],
      reconnection: false,
      auth: { ticket },
      extraHeaders: { Origin: requestOrigin },
    })

    sockets.push(s)
    await new Promise<void>((resolve, reject) => {
      s.once('connect', () => resolve())
      s.once('connect_error', reject)
    })

    return s
  }

  async function player() {
    const account = await auth.quick()

    await fundTestWallet(db, account.user.id)

    return { ...account, s: await open(account.token) }
  }

  async function emit(
    s: Socket,
    event: string,
    body: Record<string, unknown> = {},
  ): Promise<DiceReply> {
    return s.timeout(5000).emitWithAck(event, { requestId: randomUUID(), ...body })
  }

  function data(reply: DiceReply): DiceState {
    expect(reply.ok).toBe(true)

    if (!reply.ok || !('balanceMinor' in reply.data)) {
      throw new Error(JSON.stringify(reply))
    }

    return reply.data
  }

  async function start(s: Socket, mines = 3) {
    return data(await emit(s, 'dice.start', { stakeMinor: '10000', mines }))
  }

  it('rejects a changed stake on another start without replacing the active Dice round', async () => {
    const p = await player()

    const other = await open(p.token)

    const initial = await start(p.s)

    const reply = await emit(other, 'dice.start', { stakeMinor: '10000000', mines: 10 })

    expect(reply.ok).toBe(false)

    if (!reply.ok) {
      expect(reply.error.code).toBe('ACTIVE_ROUND_EXISTS')
    }

    const restored = data(await emit(other, 'dice.sync'))

    expect(restored.round).toEqual(initial.round)
    expect(restored.balanceMinor).toBe(initial.balanceMinor)
  })
  it('atomically debits, exposes only clicked cells, pays once and restores after disconnect', async () => {
    const p = await player()

    const initial = await start(p.s)

    expect(initial.balanceMinor).toBe('990000')
    expect(initial.round?.openedCells).toEqual([])

    const round = initial.round!

    const revealed = data(
      await emit(p.s, 'dice.reveal', {
        roundId: round.roundId,
        expectedVersion: 1,
        cellIndex: 4,
      }),
    )

    expect(revealed.round?.openedCells).toEqual([{ index: 4, result: 'safe' }])
    expect(revealed.round?.cashoutMinor).toBe('11000')

    const command = {
      requestId: randomUUID(),
      roundId: round.roundId,
      expectedVersion: 2,
    }

    const paid = await emit(p.s, 'dice.cashout', command)

    expect(data(paid).balanceMinor).toBe('1001000')
    expect(await emit(p.s, 'dice.cashout', command)).toEqual(paid)
    expect(await emit(p.s, 'dice.cashout', { ...command, expectedVersion: 3 })).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    })
    p.s.disconnect()

    const s = await open(p.token)

    const restored = data(await emit(s, 'dice.sync'))

    expect(restored.round?.status).toBe('CASHED_OUT')
    expect(restored.balanceMinor).toBe('1001000')
    expect(JSON.stringify(restored)).not.toMatch(/mask|seed|session|password/)

    const rows = await db.query<{ sum: string }>(
      `SELECT SUM(delta)::text AS sum FROM dice_entries WHERE user_id=:id`,
      { replacements: { id: p.user.id }, type: QueryTypes.SELECT },
    )

    expect(rows[0].sum).toBe(restored.balanceMinor)
  })
  it('rejects invalid DTO, foreign rounds, stale versions and revoked sessions', async () => {
    const a = await player()

    const b = await player()

    const r = (await start(a.s)).round!

    for (const body of [
      { cellIndex: '4' },
      { cellIndex: 25 },
      { cellIndex: 1.1 },
      { cellIndex: 4, payout: 100000 },
    ]) {
      expect(
        await emit(a.s, 'dice.reveal', {
          roundId: r.roundId,
          expectedVersion: 1,
          ...body,
        }),
      ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
    }

    expect(
      await emit(b.s, 'dice.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cellIndex: 4,
      }),
    ).toMatchObject({ ok: false, error: { code: 'ROUND_NOT_FOUND' } })
    expect(await emit(b.s, 'dice.sync', { roundId: r.roundId })).toMatchObject({
      ok: false,
      error: { code: 'ROUND_NOT_FOUND' },
    })
    expect(
      await emit(a.s, 'dice.reveal', {
        roundId: r.roundId,
        expectedVersion: 2,
        cellIndex: 4,
      }),
    ).toMatchObject({ ok: false, error: { code: 'VERSION_CONFLICT' } })
    expect(
      await emit(a.s, 'dice.cashout', {
        roundId: r.roundId,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CASHOUT_NOT_AVAILABLE' } })
    await auth.logout(a.token)
    expect(await emit(a.s, 'dice.sync')).toMatchObject({
      ok: false,
      error: { code: 'UNAUTHENTICATED' },
    })
  })
  it('serializes starts and reveal/cashout races across two sockets', async () => {
    const p = await player()

    const other = await open(p.token)

    const starts = await Promise.all([
      emit(p.s, 'dice.start', { stakeMinor: '10000', mines: 3 }),
      emit(other, 'dice.start', { stakeMinor: '10000', mines: 3 }),
    ])

    expect(starts.filter((r) => r.ok)).toHaveLength(1)

    const r = data(starts.find((r) => r.ok)!).round!

    await emit(p.s, 'dice.reveal', {
      roundId: r.roundId,
      expectedVersion: 1,
      cellIndex: 4,
    })

    const race = await Promise.all([
      emit(p.s, 'dice.reveal', {
        roundId: r.roundId,
        expectedVersion: 2,
        cellIndex: 0,
      }),
      emit(other, 'dice.cashout', { roundId: r.roundId, expectedVersion: 2 }),
    ])

    expect(race.filter((r) => r.ok)).toHaveLength(1)

    const final = data(await emit(p.s, 'dice.sync'))

    expect(['LOST', 'CASHED_OUT']).toContain(final.round?.status)
    expect(final.balanceMinor).toBe(final.round?.status === 'LOST' ? '990000' : '1001000')
  })
  it('deduplicates simultaneous starts with the same ID and recovers a missed ACK', async () => {
    const p = await player()

    const other = await open(p.token)

    const requestId = randomUUID()

    const body = { requestId, stakeMinor: '10000', mines: 3 }

    const replies = await Promise.all([
      emit(p.s, 'dice.start', body),
      emit(other, 'dice.start', body),
    ])

    expect(replies[0]).toEqual(replies[1])

    const r = data(replies[0]).round!

    const moveId = randomUUID()

    p.s.emit('dice.reveal', {
      requestId: moveId,
      roundId: r.roundId,
      expectedVersion: 1,
      cellIndex: 4,
    })

    const state = await vi.waitFor(async () => {
      const reply = await emit(other, 'dice.commandStatus', {
        operationId: moveId,
      })

      if (!reply.ok || !('response' in reply.data) || !reply.data.response) {
        throw new Error('not committed')
      }

      return reply.data.response
    })

    expect(data(state).round?.version).toBe(2)
    expect(
      await emit(other, 'dice.reveal', {
        requestId: moveId,
        roundId: r.roundId,
        expectedVersion: 1,
        cellIndex: 4,
      }),
    ).toEqual(state)
  })
  it('rolls back stake and wallet when field creation fails', async () => {
    const p = await player()

    const rng = app.get(DiceRandom)

    const spy = vi.spyOn(rng, 'field').mockImplementationOnce(() => {
      throw new Error('injected failure')
    })

    expect(await emit(p.s, 'dice.start', { stakeMinor: '10000', mines: 3 })).toMatchObject({
      ok: false,
      error: { code: 'TEMPORARILY_UNAVAILABLE' },
    })
    spy.mockRestore()

    const state = data(await emit(p.s, 'dice.sync'))

    expect(state.balanceMinor).toBe('1000000')
    expect(state.round).toBeNull()
  })
  it('never pays on a mine; cashout and repeated opened cells cannot change it', async () => {
    const p = await player()

    const r = (await start(p.s)).round!

    const lost = data(
      await emit(p.s, 'dice.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cellIndex: 0,
      }),
    )

    expect(lost.round?.openedCells).toEqual([{ index: 0, result: 'mine' }])
    expect(lost.balanceMinor).toBe('990000')
    expect(
      await emit(p.s, 'dice.cashout', {
        roundId: r.roundId,
        expectedVersion: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: 'ROUND_FINISHED' } })
  })
  it('rejects untrusted origins and reused connection tickets', async () => {
    const p = await auth.quick()

    await expect(open(p.token, 'https://evil.example')).rejects.toThrow()

    const { ticket } = await dice.ticket(p.token)

    const connect = () =>
      new Promise<void>((resolve, reject) => {
        const s = io(url + '/dice', {
          transports: ['websocket'],
          reconnection: false,
          auth: { ticket },
          extraHeaders: { Origin: origin },
        })

        sockets.push(s)
        s.once('connect', () => resolve())
        s.once('connect_error', reject)
      })

    await connect()
    await expect(connect()).rejects.toThrow()
  })

  it('automatically settles the last safe cell with exact maximum payout', async () => {
    const p = await player()

    const r = (await start(p.s, 10)).round!

    const identity = {
      userId: p.user.id,
      sessionHash: createHash('sha256').update(p.token).digest('hex'),
    }

    let last: DiceState | undefined

    for (let i = 10; i < 25; i++) {
      last = data(
        await dice.command(
          identity,
          'dice.reveal',
          Object.assign(new RevealDto(), {
            requestId: randomUUID(),
            roundId: r.roundId,
            expectedVersion: i - 9,
            cellIndex: i,
          }),
        ),
      )
    }

    expect(last?.round?.status).toBe('WON')
    expect(last?.round?.nextMultiplierHundredths).toBeNull()
    expect(last?.round?.settledPayoutMinor).toBe(payout('10000', 10, 15))

    const entries = await db.query(
      "SELECT id FROM dice_entries WHERE round_id=:id AND reason='PAYOUT'",
      { replacements: { id: r.roundId }, type: QueryTypes.SELECT },
    )

    expect(entries).toHaveLength(1)
  })
  it('rolls back a wallet credit when the payout journal fails', async () => {
    const p = await player()

    const r = (await start(p.s)).round!

    await emit(p.s, 'dice.reveal', { roundId: r.roundId, expectedVersion: 1, cellIndex: 4 })

    const spy = vi.spyOn(DiceEntry, 'create').mockRejectedValueOnce(new Error('ledger unavailable'))

    expect(
      await emit(p.s, 'dice.cashout', { roundId: r.roundId, expectedVersion: 2 }),
    ).toMatchObject({ ok: false, error: { code: 'TEMPORARILY_UNAVAILABLE' } })
    spy.mockRestore()

    const restored = data(await emit(p.s, 'dice.sync'))

    expect(restored.balanceMinor).toBe('990000')
    expect(restored.round?.status).toBe('ACTIVE')
    expect(restored.round?.version).toBe(2)
    expect(
      data(await emit(p.s, 'dice.cashout', { roundId: r.roundId, expectedVersion: 2 }))
        .balanceMinor,
    ).toBe('1001000')
  })
  it('limits connections, rejects oversized frames and stops unknown events', async () => {
    const p = await player()

    const two = await open(p.token)

    const three = await open(p.token)

    const four = await open(p.token)

    await expect(open(p.token)).rejects.toThrow()

    const disconnected = new Promise<void>((resolve) => two.once('disconnect', () => resolve()))

    two.emit('dice.unknown', { requestId: randomUUID() })
    await disconnected

    const oversized = new Promise<void>((resolve) => three.once('disconnect', () => resolve()))

    three.emit('dice.sync', { requestId: randomUUID(), padding: 'x'.repeat(5000) })
    await oversized
    four.disconnect()
  })
  it('shares rate limits across connections', async () => {
    const p = await player()

    await dice.limit('commands:' + p.user.id, 1, 1)

    for (let i = 0; i < 15; i++) {
      await dice.limit('commands:' + p.user.id, 1000, 1)
    }

    expect(await emit(p.s, 'dice.sync')).toMatchObject({
      ok: false,
      error: { code: 'RATE_LIMITED' },
    })
  })
  it('persists a round across a backend restart', async () => {
    const p = await player()

    const r = (await start(p.s)).round!

    await emit(p.s, 'dice.reveal', { roundId: r.roundId, expectedVersion: 1, cellIndex: 4 })
    sockets.forEach((s) => s.disconnect())
    await app.close()
    await boot()

    const s = await open(p.token)

    const state = data(await emit(s, 'dice.sync'))

    expect(state.round?.roundId).toBe(r.roundId)
    expect(state.round?.openedCells).toEqual([{ index: 4, result: 'safe' }])
    expect(state.balanceMinor).toBe('990000')
  })
  it('issues concurrent tickets without exhausting the connection pool', async () => {
    const account = await auth.quick()

    const tickets = await Promise.all(Array.from({ length: 12 }, () => dice.ticket(account.token)))

    expect(new Set(tickets.map((t) => t.ticket)).size).toBe(12)
  })
})
