import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { createHash, randomUUID } from 'node:crypto'
import { QueryTypes } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import { io, type Socket } from 'socket.io-client'
import { AppModule } from '../src/app.module.js'
import { AuthService } from '../src/auth/auth.service.js'
import { DiceService } from '../src/dice/dice.service.js'
import { DiceEntry } from '../src/dice/models.js'
import type {
  CachesData,
  ChestData,
  ForestData,
  NetworkState,
  OriginalState,
  OriginalsReply,
} from '../src/games/contracts.js'
import { LiveWinsController } from '../src/games/live-wins.controller.js'
import { NetworkJackpotsService } from '../src/games/network-jackpots.service.js'
import { OriginalsRandom } from '../src/games/random.js'
import { fundTestWallet } from './fund-wallet.js'

describe('server Originals and network jackpots', () => {
  let app: NestExpressApplication

  let db: Sequelize

  let auth: AuthService

  let dice: DiceService

  let network: NetworkJackpotsService

  let url: string

  let clock: Date

  const rng = {
    outer: vi.fn(() => 0),
    inner: vi.fn(() => 0),
    risk: vi.fn(() => true),
    deck: vi.fn(() => 7),
    weighted: vi.fn((_n: bigint) => 0n),
  }

  const sockets: Socket[] = []

  async function boot() {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OriginalsRandom)
      .useValue(rng)
      .compile()

    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    })
    network = app.get(NetworkJackpotsService)
    vi.spyOn(network, 'onModuleInit').mockImplementation(() => {})
    await app.listen(0, '127.0.0.1')

    const address = app.getHttpServer().address()

    if (!address || typeof address === 'string') {
      throw new Error('No address')
    }

    url = 'http://127.0.0.1:' + address.port
    db = app.get(Sequelize)
    auth = app.get(AuthService)
    dice = app.get(DiceService)
    await db.query('CREATE SEQUENCE IF NOT EXISTS test_original_periods')
  }

  beforeAll(boot, 30000)
  beforeEach(async () => {
    rng.weighted.mockReset().mockImplementation((n: bigint) => (n === 200n ? 199n : 0n))
    rng.outer.mockReturnValue(0)
    rng.inner.mockReturnValue(0)
    rng.risk.mockReturnValue(true)
    rng.deck.mockReturnValue(7)

    const [rows] = await db.query("SELECT nextval('test_original_periods') AS n")

    const n = Number((rows[0] as { n: string }).n)

    clock = new Date(Date.UTC(2090, 0, 1 + n * 10, 12, 30))
    vi.spyOn(network, 'now').mockImplementation(async () => clock)
    await db.query('DELETE FROM dice_limits WHERE key=:key', {
      replacements: {
        key: createHash('sha256').update('handshake:127.0.0.1').digest('hex'),
      },
    })
  })
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect())
    await app?.close()
  })

  async function connect(token: string) {
    const { ticket } = await dice.ticket(token)

    const s = io(url + '/dice', {
      transports: ['websocket'],
      reconnection: false,
      auth: { ticket },
      extraHeaders: { Origin: 'http://127.0.0.1:3100' },
    })

    sockets.push(s)
    await new Promise<void>((resolve, reject) => {
      s.once('connect', () => resolve())
      s.once('connect_error', reject)
    })

    return s
  }

  async function player() {
    const p = await auth.quick()

    await fundTestWallet(db, p.user.id)

    return { ...p, s: await connect(p.token) }
  }

  async function emit(
    s: Socket,
    event: string,
    body: Record<string, unknown> = {},
  ): Promise<OriginalsReply> {
    return s.timeout(8000).emitWithAck(event, { requestId: randomUUID(), ...body })
  }

  function state(r: OriginalsReply) {
    if (!r.ok || !('round' in r.data)) {
      throw new Error(JSON.stringify(r))
    }

    return r.data as OriginalState
  }

  function net(r: OriginalsReply) {
    if (!r.ok || !('pools' in r.data)) {
      throw new Error(JSON.stringify(r))
    }

    return r.data as NetworkState
  }

  async function forest(s: Socket) {
    return state(await emit(s, 'forest.start', { stakeMinor: '10000' }))
  }

  async function caches(s: Socket, cardIndex = 0, stakeMinor = '10000') {
    return state(await emit(s, 'caches.start', { stakeMinor, cardIndex }))
  }

  it.each(['forest', 'caches', 'chest'])(
    'locks %s stake and rejects a new round from either socket until settlement',
    async (game) => {
      const p = await player()

      const other = await connect(p.token)

      const initial = state(
        await emit(p.s, game + '.start', {
          stakeMinor: '10000',
          ...(game === 'caches' ? { cardIndex: 0 } : {}),
        }),
      )

      expect(initial.round?.active).toBe(true)

      const replies = await Promise.all(
        [p.s, other].map((s) =>
          emit(s, game + '.start', {
            stakeMinor: '10000000',
            ...(game === 'caches' ? { cardIndex: 1 } : {}),
          }),
        ),
      )

      for (const reply of replies) {
        expect(reply.ok).toBe(false)

        if (!reply.ok) {
          expect(reply.error.code).toBe('ACTIVE_ROUND_EXISTS')
        }
      }

      const restored = state(await emit(other, game + '.sync'))

      expect(restored.round).toEqual(initial.round)
      expect(restored.balanceMinor).toBe(initial.balanceMinor)

      const round = restored.round!

      const paid = state(
        await emit(other, game + '.cashout', {
          roundId: round.roundId,
          expectedVersion: round.version,
        }),
      )

      expect(paid.round?.active).toBe(false)

      const next = state(
        await emit(p.s, game + '.start', {
          stakeMinor: '20000',
          ...(game === 'caches' ? { cardIndex: 0 } : {}),
        }),
      )

      expect(next.round?.roundId).not.toBe(round.roundId)
      expect(next.round?.stakeMinor).toBe('20000')
    },
  )
  it('publishes confirmed wins with masked players and no private fields', async () => {
    const p = await player()

    const initial = await forest(p.s)

    const r = initial.round!

    await emit(p.s, 'forest.cashout', { roundId: r.roundId, expectedVersion: r.version })

    const alias =
      p.user.login.length > 5
        ? p.user.login.slice(0, 2) + '***' + p.user.login.slice(-1)
        : p.user.login.slice(0, 1) + '***'

    const feed = await app.get(LiveWinsController).get()

    const win = feed.wins.find((row) => row.player === alias)

    expect(win).toBeDefined()
    expect(win?.amountMinor).toBe('14000')
    expect(win?.game).toBe('forest')
    expect(Object.keys(win!).sort()).toEqual(
      ['id', 'player', 'game', 'amountMinor', 'createdAt'].sort(),
    )
    expect(JSON.stringify(feed)).not.toContain(p.user.login)
    expect(JSON.stringify(feed)).not.toContain(p.user.id)
    expect(feed.wins.length).toBeLessThanOrEqual(20)
  })
  it('counts unique players per game in the last 24 hours without exposing identities', async () => {
    const controller = app.get(LiveWinsController)

    const before = await controller.players()

    const p = await player()

    const first = await forest(p.s)

    const r = first.round!

    await emit(p.s, 'forest.cashout', { roundId: r.roundId, expectedVersion: r.version })
    await forest(p.s)

    const current = await controller.players()

    expect(current.period).toBe('24h')
    expect(current.games.forest).toBe(before.games.forest! + 1)
    expect(Object.keys(current.games).sort()).toEqual(['caches', 'chest', 'dice', 'forest'])
    expect(JSON.stringify(current)).not.toContain(p.user.id)
    await db.query(
      "UPDATE original_rounds SET created_at=NOW()-INTERVAL '25 hours' WHERE user_id=:id",
      { replacements: { id: p.user.id } },
    )
    expect((await controller.players()).games.forest).toBe(before.games.forest)
  })

  async function due() {
    await db.query(
      "UPDATE jackpot_periods SET starts_at=clock_timestamp()-INTERVAL '2 minutes',ends_at=clock_timestamp()-INTERVAL '1 minute' WHERE starts_at>:future AND status='OPEN'",
      { replacements: { future: new Date(Date.UTC(2089, 0, 1)) } },
    )
    await network.settleDue()
  }

  it('shares one grant and wallet with Dice; cashout has exactly one effect', async () => {
    const p = await player()

    const initial = await forest(p.s)

    const r = initial.round!

    expect(initial.balanceMinor).toBe('990000')
    expect((r.data as ForestData).offerMinor).toBe('14000')

    const requestId = randomUUID()

    const body = { requestId, roundId: r.roundId, expectedVersion: 1 }

    const paid = await emit(p.s, 'forest.cashout', body)

    expect(state(paid).balanceMinor).toBe('1004000')
    expect(await emit(p.s, 'forest.cashout', body)).toEqual(paid)

    const diceState = await p.s.timeout(8000).emitWithAck('dice.sync', { requestId: randomUUID() })

    expect(diceState.data.balanceMinor).toBe('1004000')

    const grants = await db.query(
      "SELECT id FROM dice_entries WHERE user_id=:user AND reason='GRANT'",
      { replacements: { user: p.user.id }, type: QueryTypes.SELECT },
    )

    expect(grants).toHaveLength(0)
  })
  it('persists five crystal contributions and settles the collection without animation requests', async () => {
    rng.outer.mockReturnValue(1)

    const p = await player()

    let result: OriginalState | undefined

    for (let i = 0; i < 5; i++) {
      result = await forest(p.s)
    }

    expect(result?.crystals).toBe(5)
    expect(result?.crystalBonusMinor).toBe('0')
    expect((result!.round!.data as ForestData).crystalAwardMinor).toBe('2500')
    expect(result?.balanceMinor).toBe('977500')
  })
  it('charges a key once and server-selects the inner result', async () => {
    rng.outer.mockReturnValue(3)

    const p = await player()

    const r = (await forest(p.s)).round!

    const charged = state(
      await emit(p.s, 'forest.charge', {
        roundId: r.roundId,
        expectedVersion: 1,
      }),
    )

    expect((charged.round!.data as ForestData).keyMultiplier).toBe(2)
    expect(
      await emit(p.s, 'forest.charge', {
        roundId: r.roundId,
        expectedVersion: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_PHASE' } })

    const won = state(
      await emit(p.s, 'forest.spin', {
        roundId: r.roundId,
        expectedVersion: 2,
        target: 0,
      }),
    )

    expect(won.round?.payoutMinor).toBe('180000')
    expect(won.balanceMinor).toBe('1170000')
  })
  it('coin risk and lost key settle exactly once', async () => {
    const p = await player()

    const r = (await forest(p.s)).round!

    const won = state(
      await emit(p.s, 'forest.risk', {
        roundId: r.roundId,
        expectedVersion: 1,
      }),
    )

    expect(won.round?.payoutMinor).toBe('28000')
    rng.outer.mockReturnValue(3)
    rng.risk.mockReturnValue(false)

    const key = (await forest(p.s)).round!

    const lost = state(
      await emit(p.s, 'forest.charge', {
        roundId: key.roundId,
        expectedVersion: 1,
      }),
    )

    expect(lost.round?.payoutMinor).toBe('0')
    expect(lost.round?.active).toBe(false)
  })

  it('chest guarantees 93.2%, cashout is idempotent and never credited twice', async () => {
    const p = await player()

    const command = { requestId: randomUUID(), stakeMinor: '10000' }

    const first = (await p.s.timeout(8000).emitWithAck('chest.start', command)) as OriginalsReply

    expect(await p.s.timeout(8000).emitWithAck('chest.start', command)).toEqual(first)

    const r = state(first).round!

    expect(state(first).balanceMinor).toBe('990000')
    expect(r.data).toMatchObject({
      stage: 1,
      offerMinor: '9320',
      nextPayoutMinor: '9524',
      nextChanceNumerator: 95,
      nextChanceDenominator: 100,
    })
    expect(state(await emit(p.s, 'chest.sync')).round).toEqual(r)
    expect((await emit(p.s, 'chest.start', { stakeMinor: '10000' })).ok).toBe(false)

    const cash = { requestId: randomUUID(), roundId: r.roundId, expectedVersion: 1 }

    const paid = (await p.s.timeout(8000).emitWithAck('chest.cashout', cash)) as OriginalsReply

    expect(await p.s.timeout(8000).emitWithAck('chest.cashout', cash)).toEqual(paid)
    expect(state(paid).balanceMinor).toBe('999320')
    expect(state(paid).round).toMatchObject({ active: false, payoutMinor: '9320' })
  })
  it('chest loses only the reserved stake, restores loss and rejects further opens', async () => {
    const p = await player()

    const first = state(await emit(p.s, 'chest.start', { stakeMinor: '10000' })).round!

    rng.weighted.mockImplementationOnce((n) => n - 1n)

    const lost = state(
      await emit(p.s, 'chest.open', { roundId: first.roundId, expectedVersion: 1 }),
    )

    expect(lost.round).toMatchObject({
      active: false,
      payoutMinor: '0',
      data: { phase: 'lost', offerMinor: '0', stage: 1 },
    })
    expect(lost.balanceMinor).toBe('990000')
    expect(state(await emit(p.s, 'chest.sync')).round).toEqual(lost.round)
    expect(
      (await emit(p.s, 'chest.cashout', { roundId: first.roundId, expectedVersion: 2 })).ok,
    ).toBe(false)
  })
  it('chest stops after six risks and requires explicit cashout', async () => {
    const p = await player()

    let r = state(await emit(p.s, 'chest.start', { stakeMinor: '10000' })).round!

    for (let stage = 2; stage <= 7; stage++) {
      r = state(
        await emit(p.s, 'chest.open', { roundId: r.roundId, expectedVersion: r.version }),
      ).round!
      expect((r.data as ChestData).items).toHaveLength(stage)
      expect(JSON.stringify(r)).not.toMatch(/"seed"|"secret"|"mask"/)
    }

    expect(r).toMatchObject({
      active: true,
      payoutMinor: '0',
      data: { phase: 'offer', stage: 7, offerMinor: '10740080' },
    })
    expect(
      (await emit(p.s, 'chest.open', { roundId: r.roundId, expectedVersion: r.version })).ok,
    ).toBe(false)

    const paid = state(
      await emit(p.s, 'chest.cashout', { roundId: r.roundId, expectedVersion: r.version }),
    )

    expect(paid.balanceMinor).toBe('11730080')
  })
  it('chest validates commands, ownership and concurrent versions', async () => {
    const p = await player()

    const stranger = await player()

    expect(
      (await emit(p.s, 'chest.start', { stakeMinor: '10000', offerMinor: '9999999' })).ok,
    ).toBe(false)
    expect((await emit(p.s, 'chest.start', { stakeMinor: '1' })).ok).toBe(false)

    const r = state(await emit(p.s, 'chest.start', { stakeMinor: '10000' })).round!

    expect(
      (await emit(stranger.s, 'chest.cashout', { roundId: r.roundId, expectedVersion: 1 })).ok,
    ).toBe(false)

    const other = await connect(p.token)

    const results = await Promise.all([
      emit(p.s, 'chest.open', { roundId: r.roundId, expectedVersion: 1 }),
      emit(other, 'chest.cashout', { roundId: r.roundId, expectedVersion: 1 }),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)

    const restored = state(await emit(p.s, 'chest.sync'))

    expect(restored.round!.version).toBe(2)
  })

  it('chest keys compound and replay never draws or pays twice', async () => {
    const p = await player()

    rng.weighted.mockReturnValueOnce(0n)

    const first = state(await emit(p.s, 'chest.start', { stakeMinor: '10000' }))

    expect(first.round!.data).toMatchObject({
      lastKey: 'gold',
      beforeKeyMinor: '9320',
      offerMinor: '18640',
    })
    rng.weighted.mockReturnValueOnce(0n).mockReturnValueOnce(1n)

    const cmd = { requestId: randomUUID(), roundId: first.round!.roundId, expectedVersion: 1 }

    const next = (await p.s.timeout(8000).emitWithAck('chest.open', cmd)) as OriginalsReply

    expect(state(next).round!.data).toMatchObject({
      lastKey: 'silver',
      beforeKeyMinor: '19049',
      offerMinor: '28574',
      nextGoldenPayoutMinor: '65275',
    })

    const draws = rng.weighted.mock.calls.length

    expect(await p.s.timeout(8000).emitWithAck('chest.open', cmd)).toEqual(next)
    expect(rng.weighted.mock.calls.length).toBe(draws)

    const paid = state(
      await emit(p.s, 'chest.cashout', { roundId: cmd.roundId, expectedVersion: 2 }),
    )

    expect(paid.balanceMinor).toBe('1018574')
  })
  it('keeps the deck private, pays three treasures and contributes once to both pools', async () => {
    const p = await player()

    const first = await caches(p.s)

    const r = first.round!

    expect((r.data as CachesData).opened).toHaveLength(1)
    expect(r.data).not.toHaveProperty('revealed')
    expect(first.history.every((h) => !('revealed' in h.data))).toBe(true)

    const second = state(
      await emit(p.s, 'caches.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cardIndex: 1,
      }),
    )

    expect((second.round!.data as CachesData).opened).toEqual([
      { index: 1, result: 'treasure', rank: 2, payoutMinor: '48000' },
    ])

    const last = state(
      await emit(p.s, 'caches.reveal', {
        roundId: r.roundId,
        expectedVersion: 2,
        cardIndex: 2,
      }),
    )

    expect(last.round?.payoutMinor).toBe('192000')
    expect(last.balanceMinor).toBe('1182000')
    expect((last.round!.data as CachesData).revealed).toEqual(
      Array.from({ length: 6 }, (_, index) => ({
        index,
        result: index < 3 ? 'treasure' : 'empty',
      })),
    )
    expect((last.round!.data as CachesData).opened).toHaveLength(3)
    expect(JSON.stringify(last)).not.toMatch(/"secret"|"mask"|"seed"|"winner_id"/)

    const pools = net(await emit(p.s, 'jackpots.sync')).pools

    expect(pools.map((p) => p.amountMinor)).toEqual(['100', '100'])
  })
  it.each(['cashout', 'loss', 'first-loss'])(
    'reveals the fixed board only after %s and restores it',
    async (ending) => {
      const p = await player()

      const initial = await caches(p.s, ending === 'first-loss' ? 5 : 0)

      let final = initial

      if (ending !== 'first-loss') {
        expect(initial.round!.data).not.toHaveProperty('revealed')

        const restored = state(await emit(p.s, 'caches.sync'))

        expect(restored.round!.data).not.toHaveProperty('revealed')
        final = state(
          await emit(p.s, ending === 'cashout' ? 'caches.cashout' : 'caches.reveal', {
            roundId: initial.round!.roundId,
            expectedVersion: 1,
            ...(ending === 'loss' ? { cardIndex: 5 } : {}),
          }),
        )
      }

      expect(final.round!.active).toBe(false)

      const data = final.round!.data as CachesData

      expect(data.revealed).toEqual(
        Array.from({ length: 6 }, (_, index) => ({
          index,
          result: index < 3 ? 'treasure' : 'empty',
        })),
      )
      expect(data.opened).toHaveLength(ending === 'loss' ? 2 : 1)

      const restored = state(await emit(p.s, 'caches.sync'))

      expect(restored.round!.data).toEqual(data)
      expect(restored.balanceMinor).toBe(final.balanceMinor)
      expect(restored.history.find((h) => h.roundId === final.round!.roundId)?.data).toEqual(data)
    },
  )
  it('serializes cashout against an empty card and rejects forged DTOs and foreign rounds', async () => {
    const p = await player()

    const other = await connect(p.token)

    const stranger = await player()

    const r = (await caches(p.s)).round!

    expect(
      await emit(stranger.s, 'caches.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cardIndex: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'ROUND_NOT_FOUND' } })
    expect(
      await emit(p.s, 'caches.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cardIndex: 3,
        payoutMinor: '999999',
      }),
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })

    const replies = await Promise.all([
      emit(p.s, 'caches.reveal', {
        roundId: r.roundId,
        expectedVersion: 1,
        cardIndex: 3,
      }),
      emit(other, 'caches.cashout', { roundId: r.roundId, expectedVersion: 1 }),
    ])

    expect(replies.filter((r) => r.ok)).toHaveLength(1)

    const restored = state(await emit(p.s, 'caches.sync'))

    expect(['990000', '1009200']).toContain(restored.balanceMinor)
    expect(restored.round?.active).toBe(false)
  })
  it('rolls back both pool contributions, bet and balance if funding fails', async () => {
    const p = await player()

    const original = network.contribute.bind(network)

    const spy = vi.spyOn(network, 'contribute').mockImplementationOnce(async (...args) => {
      await original(...args)
      throw new Error('injected')
    })

    expect(await emit(p.s, 'caches.start', { stakeMinor: '10000', cardIndex: 0 })).toMatchObject({
      ok: false,
      error: { code: 'TEMPORARILY_UNAVAILABLE' },
    })
    spy.mockRestore()

    const restored = state(await emit(p.s, 'caches.sync'))

    expect(restored.balanceMinor).toBe('1000000')
    expect(restored.round).toBeNull()
    expect(net(await emit(p.s, 'jackpots.sync')).pools.map((p) => p.amountMinor)).toEqual([
      '0',
      '0',
    ])
  })
  it('reserves scheduled banks, restores choices, rejects non-winners and credits a concurrent claim once', async () => {
    const a = await player()

    const b = await player()

    await caches(a.s, 5)
    await caches(b.s, 5, '20000')
    await due()

    const periods = await db.query<{
      id: string
      winner_id: string
      amount: string
    }>(
      "SELECT p.id,p.winner_id,p.amount FROM jackpot_periods p JOIN jackpot_participants j ON j.period_id=p.id WHERE j.user_id=:user AND p.pool='mini' AND p.status='DRAWN'",
      { replacements: { user: a.user.id }, type: QueryTypes.SELECT },
    )

    const period = periods[0]

    expect(period.amount).toBe('300')

    const winner = period.winner_id === a.user.id ? a : b

    const loser = winner === a ? b : a

    const winnerQueue = net(await emit(winner.s, 'jackpots.sync'))

    expect(winnerQueue.pending.some((d) => d.drawId === period.id)).toBe(true)

    const loserQueue = net(await emit(loser.s, 'jackpots.sync'))

    expect(loserQueue.pending.some((d) => d.drawId === period.id)).toBe(true)
    expect(loserQueue.hasMore).toBe(false)
    expect(
      await emit(winner.s, 'jackpots.claim', {
        drawId: period.id,
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CLAIM_NOT_READY' } })

    let current = net(await emit(winner.s, 'jackpots.sync', { drawId: period.id })).draw!

    for (let i = 0; i < 3; i++) {
      current = net(
        await emit(winner.s, 'jackpots.reveal', {
          drawId: period.id,
          expectedVersion: current.version,
          cardIndex: i,
        }),
      ).draw!
    }

    expect(current.result).toBe('won')
    expect(current.cards.map((c) => c.symbol)).toEqual(['nebi', 'nebi', 'nebi'])

    const before = net(await emit(winner.s, 'jackpots.sync')).balanceMinor

    const second = await connect(winner.token)

    const payload = {
      requestId: randomUUID(),
      drawId: period.id,
      expectedVersion: current.version,
    }

    const paid = await Promise.all([
      emit(winner.s, 'jackpots.claim', payload),
      emit(second, 'jackpots.claim', payload),
    ])

    expect(paid[0]).toEqual(paid[1])
    expect(net(paid[0]).balanceMinor).toBe((BigInt(before) + 300n).toString())

    let losing = net(await emit(loser.s, 'jackpots.sync', { drawId: period.id })).draw!

    for (let i = 0; i < 3; i++) {
      losing = net(
        await emit(loser.s, 'jackpots.reveal', {
          drawId: period.id,
          expectedVersion: losing.version,
          cardIndex: i,
        }),
      ).draw!
    }

    expect(losing.result).toBe('lost')
    expect(new Set(losing.cards.map((c) => c.symbol)).size).toBe(3)
    expect(
      await emit(loser.s, 'jackpots.claim', {
        drawId: period.id,
        expectedVersion: losing.version,
      }),
    ).toMatchObject({ ok: false, error: { code: 'NOT_WINNER' } })
    clock = new Date(clock.getTime() + 86400000)
    await caches(a.s, 5)
    expect(net(await emit(b.s, 'jackpots.sync')).pools.map((p) => p.amountMinor)).toEqual([
      '100',
      '100',
    ])

    const entries = await db.query('SELECT id FROM dice_entries WHERE jackpot_period_id=:id', {
      replacements: { id: period.id },
      type: QueryTypes.SELECT,
    })

    expect(entries).toHaveLength(1)
  })
  it('leaves a reserved prize unpaid if the wallet journal fails', async () => {
    const p = await player()

    await caches(p.s, 5)
    await due()

    let draw = net(await emit(p.s, 'jackpots.sync')).pending[0]

    for (let i = 0; i < 3; i++) {
      draw = net(
        await emit(p.s, 'jackpots.reveal', {
          drawId: draw.drawId,
          expectedVersion: draw.version,
          cardIndex: i,
        }),
      ).draw!
    }

    const spy = vi.spyOn(DiceEntry, 'create').mockRejectedValueOnce(new Error('ledger unavailable'))

    const command = {
      requestId: randomUUID(),
      drawId: draw.drawId,
      expectedVersion: draw.version,
    }

    expect(await emit(p.s, 'jackpots.claim', command)).toMatchObject({
      ok: false,
      error: { code: 'TEMPORARILY_UNAVAILABLE' },
    })
    spy.mockRestore()

    const restored = net(await emit(p.s, 'jackpots.sync', { drawId: draw.drawId }))

    expect(restored.draw?.result).toBe('won')
    expect(restored.balanceMinor).toBe('990000')
    expect(net(await emit(p.s, 'jackpots.claim', command)).balanceMinor).toBe('990100')
  })

  it('qualifies caches participants only in the hour and Moscow day of their bet', async () => {
    const first = await player()

    const second = await player()

    const nextDay = await player()

    const otherGame = await player()

    await forest(otherGame.s)

    const periods = async (user: string) =>
      db.query<{ pool: string; period_id: string }>(
        'SELECT p.pool,j.period_id FROM jackpot_participants j JOIN jackpot_periods p ON p.id=j.period_id WHERE j.user_id=:user ORDER BY p.pool',
        { replacements: { user }, type: QueryTypes.SELECT },
      )

    expect(await periods(otherGame.user.id)).toEqual([])
    await caches(first.s, 5)

    const a = await periods(first.user.id)

    expect(a.map((p) => p.pool)).toEqual(['mega', 'mini'])
    clock = new Date(clock.getTime() + 3600000)
    await caches(second.s, 5)

    const b = await periods(second.user.id)

    expect(b[0].period_id).toBe(a[0].period_id)
    expect(b[1].period_id).not.toBe(a[1].period_id)
    clock = new Date(clock.getTime() + 86400000)
    await caches(nextDay.s, 5)

    const c = await periods(nextDay.user.id)

    expect(c.every((p) => !a.concat(b).some((old) => old.period_id === p.period_id))).toBe(true)
    expect(await periods(first.user.id)).toEqual(a)
    expect(await periods(second.user.id)).toEqual(b)
  })

  it('deduplicates a cache start across sockets including both pool contributions', async () => {
    const p = await player()

    const other = await connect(p.token)

    const command = { requestId: randomUUID(), stakeMinor: '1100', cardIndex: 0 }

    const results = await Promise.all([
      emit(p.s, 'caches.start', command),
      emit(other, 'caches.start', command),
    ])

    expect(results[0]).toEqual(results[1])
    expect(state(results[0]).balanceMinor).toBe('998900')

    const pools = net(await emit(p.s, 'jackpots.sync')).pools

    expect(pools.map((p) => p.amountMinor)).toEqual(['11', '11'])
    expect(await emit(p.s, 'caches.start', { ...command, cardIndex: 1 })).toMatchObject({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    })
  })
  it('serializes bets in different games against the same available wallet', async () => {
    const p = await player()

    const other = await connect(p.token)

    const results = await Promise.all([
      emit(p.s, 'forest.start', { stakeMinor: '1000000' }),
      emit(other, 'caches.start', { stakeMinor: '1000000', cardIndex: 0 }),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.find((r) => !r.ok)).toMatchObject({
      ok: false,
      error: { code: 'INSUFFICIENT_FUNDS' },
    })
    expect(state(await emit(p.s, 'forest.sync')).balanceMinor).toBe('0')
  })
  it('draw settlement is exclusive and repeated or foreign card opens cannot claim', async () => {
    const p = await player()

    const outsider = await player()

    await caches(p.s, 5)
    await db.query(
      "UPDATE jackpot_periods SET starts_at=clock_timestamp()-INTERVAL '2 minutes',ends_at=clock_timestamp()-INTERVAL '1 minute' WHERE starts_at>:future AND status='OPEN'",
      { replacements: { future: new Date(Date.UTC(2089, 0, 1)) } },
    )
    await Promise.all([network.settleDue(), network.settleDue()])

    const pending = net(await emit(p.s, 'jackpots.sync')).pending

    expect(pending).toHaveLength(2)

    const d = pending[0]

    const command = {
      requestId: randomUUID(),
      drawId: d.drawId,
      expectedVersion: d.version,
      cardIndex: 0,
    }

    expect(await emit(outsider.s, 'jackpots.reveal', command)).toMatchObject({
      ok: false,
      error: { code: 'DRAW_NOT_FOUND' },
    })

    const opened = await emit(p.s, 'jackpots.reveal', command)

    expect(net(opened).draw?.cards).toHaveLength(1)
    expect(await emit(p.s, 'jackpots.reveal', command)).toEqual(opened)
    expect(
      await emit(p.s, 'jackpots.reveal', {
        drawId: d.drawId,
        expectedVersion: 2,
        cardIndex: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CELL_ALREADY_OPENED' } })

    const outbox = await db.query('SELECT id FROM jackpot_outbox WHERE period_id=:id', {
      replacements: { id: d.drawId },
      type: QueryTypes.SELECT,
    })

    expect(outbox).toHaveLength(1)
    expect(await network.settleDue()).toBe(0)
  })

  it('preserves an active key and pending jackpot across backend restart', async () => {
    rng.outer.mockReturnValue(3)

    const p = await player()

    const r = (await forest(p.s)).round!

    await caches(p.s, 5)
    await due()

    const draws = net(await emit(p.s, 'jackpots.sync')).pending.map((d) => d.drawId)

    sockets.forEach((s) => s.disconnect())
    await app.close()
    await boot()

    const s = await connect(p.token)

    const restored = state(await emit(s, 'forest.sync'))

    expect(restored.round?.roundId).toBe(r.roundId)
    expect((restored.round!.data as ForestData).phase).toBe('key')
    expect(net(await emit(s, 'jackpots.sync')).pending.map((d) => d.drawId)).toEqual(draws)
  })
})
