import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { QueryTypes, type Transaction } from 'sequelize'
import { AppModule } from '../src/app.module.js'
import { AuthService } from '../src/auth/auth.service.js'
import { BonusService } from '../src/bonuses/bonus.service.js'
import { choosePrize, guestDigest } from '../src/bonuses/bonus.utils.js'
import type { DiceEvent, DiceState } from '../src/dice/contracts.js'
import { DiceService } from '../src/dice/dice.service.js'
import { DiceRandom } from '../src/dice/math.js'
import type { Identity } from '../src/games/account.types.js'
import type { OriginalsEvent, OriginalState } from '../src/games/contracts.js'
import { NetworkJackpotsService } from '../src/games/network-jackpots.service.js'
import { OriginalsService } from '../src/games/originals.service.js'
import { OriginalsRandom } from '../src/games/random.js'
import { fundTestWallet } from './fund-wallet.js'

describe('bonus wheel economy', () => {
  let app: NestExpressApplication

  let auth: AuthService

  let bonus: BonusService

  const rows = <T extends object>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ): Promise<T[]> => bonus.db.query<T>(sql, { replacements, transaction, type: QueryTypes.SELECT })

  let dice: DiceService

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OriginalsRandom)
      .useValue({
        outer: () => 0,
        inner: () => 0,
        risk: () => true,
        deck: () => 7,
        weighted: (n: bigint) => (n === 200n ? 199n : 0n),
      })
      .overrideProvider(DiceRandom)
      .useValue({ field: () => 1 })
      .compile()

    app = module.createNestApplication({ logger: false })
    vi.spyOn(app.get(NetworkJackpotsService), 'onModuleInit').mockImplementation(() => {})
    await app.init()
    auth = app.get(AuthService)
    bonus = app.get(BonusService)
    dice = app.get(DiceService)
  }, 30000)
  afterAll(async () => {
    await app?.close()
  })

  async function player() {
    const p = await auth.quick()

    await fundTestWallet(bonus.db, p.user.id)

    return {
      userId: p.user.id,
      sessionHash: createHash('sha256').update(p.token).digest('hex'),
    }
  }

  it('marks a claimed guest gift as unavailable after logout', async () => {
    const guest = guestDigest(randomBytes(32).toString('base64url'))

    const draw = await bonus.spin(null, guest, 'welcome')

    const who = await player()

    await bonus.db.transaction((t) => bonus.bindGuest(who.userId, guest, t))

    const status = await bonus.status(null, guest)

    expect(status.guestClaimed).toBe(true)
    expect(status.welcome).toBeNull()
    await expect(bonus.spin(null, guest, 'welcome')).rejects.toThrow()
    expect((await bonus.status(who.userId, guest)).welcome?.id).toBe(draw?.id)
  })

  async function grant(who: Identity, game = 'dice') {
    const d = (await bonus.spin(who.userId, '', 'welcome'))!

    await rows('UPDATE bonus_draws SET game=:game,rounds=1,stake=1000 WHERE id=:id RETURNING id', {
      id: d.id,
      game,
    })
    await bonus.claim(who.userId, d.id)

    return d.id
  }

  async function command(who: Identity, event: DiceEvent, fields: Record<string, unknown> = {}) {
    const reply = await dice.command(who, event, {
      requestId: randomUUID(),
      ...fields,
    })

    if (!reply.ok) {
      throw Error(reply.error.message)
    }

    return reply.data as DiceState
  }

  async function record(id: string) {
    return (
      await rows<{
        remaining: number
        winnings: string
        required: string
        wagered: string
        released: boolean
      }>('SELECT * FROM bonus_grants WHERE id=:id', { id })
    )[0]
  }

  it('uses approved weighted packages', () => {
    const counts = Array(8).fill(0)

    for (let i = 0; i < 100; i++) {
      counts[choosePrize(i)]++
    }

    expect(counts).toEqual([30, 20, 15, 10, 12, 8, 3, 2])
  })
  it('reserves one guest result and claims it atomically at registration', async () => {
    const token = randomBytes(32).toString('base64url')

    const hash = guestDigest(token)

    const draws = await Promise.all([
      bonus.spin(null, hash, 'welcome'),
      bonus.spin(null, hash, 'welcome'),
    ])

    expect(draws[0]!.id).toBe(draws[1]!.id)

    const p = await auth.quick(undefined, token)

    await Promise.all([bonus.claim(p.user.id, draws[0]!.id), bonus.claim(p.user.id, draws[0]!.id)])

    const s = await bonus.status(p.user.id, hash)

    expect(s.welcome?.claimed).toBe(true)
    expect(s.grants).toHaveLength(1)
    expect(s.grants[0].remaining).toBe(draws[0]!.rounds)
    await expect(bonus.spin(null, hash, 'welcome')).rejects.toThrow()
  })
  it('requires confirmed current-week deposits and reserves only one weekly prize', async () => {
    const p = await player()

    await expect(bonus.spin(p.userId, '', 'weekly')).rejects.toThrow()
    await rows(
      'INSERT INTO confirmed_deposits(id,user_id,amount_minor,confirmed_at) VALUES(:id,:user,99900,NOW()) RETURNING id',
      { id: randomUUID(), user: p.userId },
    )
    await expect(bonus.spin(p.userId, '', 'weekly')).rejects.toThrow()
    await rows(
      'INSERT INTO confirmed_deposits(id,user_id,amount_minor,confirmed_at) VALUES(:id,:user,100,NOW()) RETURNING id',
      { id: randomUUID(), user: p.userId },
    )

    const d = await Promise.all([
      bonus.spin(p.userId, '', 'weekly'),
      bonus.spin(p.userId, '', 'weekly'),
    ])

    expect(d[0]!.id).toBe(d[1]!.id)
  })
  it('does not debit FS, escrows winnings, counts paid turnover once and releases exactly once', async () => {
    const p = await player()

    const id = await grant(p)

    const initial = (await command(p, 'dice.sync')).balanceMinor

    let s = await command(p, 'dice.start', {
      stakeMinor: '1000',
      mines: 1,
      bonusGrantId: id,
    })

    expect(s.balanceMinor).toBe(initial)
    expect(s.bonusGrants?.find((g) => g.id === id)?.remaining).toBe(0)
    await expect(
      command(p, 'dice.start', {
        stakeMinor: '1000',
        mines: 1,
        bonusGrantId: id,
      }),
    ).rejects.toThrow()
    s = await command(p, 'dice.reveal', {
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
      cellIndex: 1,
    })
    s = await command(p, 'dice.cashout', {
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
    })

    const won = BigInt(s.round!.settledPayoutMinor)

    expect(won).toBeGreaterThan(0n)
    expect(s.balanceMinor).toBe(initial)

    let g = await record(id)

    expect(g.remaining).toBe(0)
    expect(BigInt(g.required)).toBe(won * 2n)
    expect(s.bonusGrants?.find((g) => g.id === id)?.winningsMinor).toBe(won.toString())
    expect(g.released).toBe(false)

    let paid = 0n

    while (paid < won * 2n) {
      s = await command(p, 'dice.start', { stakeMinor: '1000', mines: 1 })

      const input = {
        requestId: randomUUID(),
        roundId: s.round!.roundId,
        expectedVersion: s.round!.version,
        cellIndex: 0,
      }

      await dice.command(p, 'dice.reveal', input)
      await dice.command(p, 'dice.reveal', input)
      paid += 1000n
    }

    g = await record(id)
    expect(g.released).toBe(true)
    expect(BigInt(g.wagered)).toBe(won * 2n)
    s = await command(p, 'dice.sync')
    expect(BigInt(s.balanceMinor)).toBe(BigInt(initial) - paid + won)
    expect(
      await rows(
        "SELECT id FROM dice_entries WHERE bonus_grant_id=:id AND reason='BONUS_RELEASE'",
        { id },
      ),
    ).toHaveLength(1)
  })
  it('rejects wrong stake, foreign owner and expired package without consuming it', async () => {
    const p = await player()

    const id = await grant(p)

    const other = await player()

    await expect(
      command(p, 'dice.start', {
        stakeMinor: '2000',
        mines: 1,
        bonusGrantId: id,
      }),
    ).rejects.toThrow()
    await expect(
      command(other, 'dice.start', {
        stakeMinor: '1000',
        mines: 1,
        bonusGrantId: id,
      }),
    ).rejects.toThrow()
    await rows(
      "UPDATE bonus_grants SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id RETURNING id",
      { id },
    )
    await expect(
      command(p, 'dice.start', {
        stakeMinor: '1000',
        mines: 1,
        bonusGrantId: id,
      }),
    ).rejects.toThrow()
    expect((await record(id)).remaining).toBe(1)
  })
  it.each(['forest', 'caches', 'chest'])('supports free rounds in %s', async (game) => {
    const who = await player()

    const id = await grant(who, game)

    const service = app.get(OriginalsService)

    async function act(action: string, fields: Record<string, unknown> = {}) {
      const r = await service.command(who, (game + '.' + action) as OriginalsEvent, {
        requestId: randomUUID(),
        ...fields,
      })

      if (!r.ok) {
        throw Error(r.error.message)
      }

      return r.data as OriginalState
    }

    const initial = (await act('sync')).balanceMinor

    let s = await act('start', {
      stakeMinor: '1000',
      cardIndex: 0,
      bonusGrantId: id,
    })

    expect(s.balanceMinor).toBe(initial)
    await expect(
      act('start', { stakeMinor: '1000', cardIndex: 0, bonusGrantId: id }),
    ).rejects.toThrow()
    s = await act('cashout', {
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
    })
    expect(s.balanceMinor).toBe(initial)

    const g = await record(id)

    expect(g.remaining).toBe(0)
    expect(s.bonusGrants?.find((g) => g.id === id)).toMatchObject({
      remaining: 0,
      winningsMinor: g.winnings,
    })
    expect(BigInt(g.winnings)).toBeGreaterThan(0n)
    expect(BigInt(g.required)).toBe(BigInt(g.winnings) * 2n)
  })
  it('reconciles expired fully wagered packages on status refresh once', async () => {
    const who = await player()

    const id = await grant(who)

    const initial = (await command(who, 'dice.sync')).balanceMinor

    await rows(
      "UPDATE bonus_grants SET balance=30000,winnings=30000,required=60000,wagered=60000,expires_at=NOW()-INTERVAL '1 second' WHERE id=:id RETURNING id",
      { id },
    )
    await Promise.all([bonus.status(who.userId, ''), bonus.status(who.userId, '')])
    expect((await record(id)).released).toBe(true)
    expect(BigInt((await command(who, 'dice.sync')).balanceMinor)).toBe(BigInt(initial) + 30000n)
  })
  it('starts a new account at zero and never writes a starter grant', async () => {
    const account = await auth.quick()

    const who = {
      userId: account.user.id,
      sessionHash: createHash('sha256').update(account.token).digest('hex'),
    }

    expect((await command(who, 'dice.sync')).balanceMinor).toBe('0')
    await expect(command(who, 'dice.start', { stakeMinor: '1000', mines: 1 })).rejects.toThrow()
    expect(
      await rows('SELECT id FROM dice_entries WHERE user_id=:user', { user: who.userId }),
    ).toHaveLength(0)

    const id = await grant(who)

    const free = await command(who, 'dice.start', {
      stakeMinor: '1000',
      mines: 1,
      bonusGrantId: id,
    })

    expect(free.balanceMinor).toBe('0')
  })
  it('spends bonus funds, returns wins to them and releases only the remaining balance once', async () => {
    const who = await player()

    const id = await grant(who)

    await rows(
      'UPDATE bonus_grants SET remaining=0,winnings=20000,balance=20000,required=40000,wagered=38000 WHERE id=:id RETURNING id',
      { id },
    )

    const initial = BigInt((await command(who, 'dice.sync')).balanceMinor)

    let s = await command(who, 'dice.start', { stakeMinor: '1000', mines: 1, bonusWalletId: id })

    expect(BigInt(s.balanceMinor)).toBe(initial)
    expect(s.bonusGrants?.find((g) => g.id === id)?.balanceMinor).toBe('19000')
    s = await command(who, 'dice.reveal', {
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
      cellIndex: 1,
    })
    s = await command(who, 'dice.cashout', {
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
    })

    const win = BigInt(s.round!.settledPayoutMinor)

    expect(s.bonusGrants?.find((g) => g.id === id)).toMatchObject({
      balanceMinor: String(19000n + win),
      requiredMinor: '40000',
      wageredMinor: '39000',
      released: false,
    })
    s = await command(who, 'dice.start', { stakeMinor: '1000', mines: 1, bonusWalletId: id })

    const body = {
      requestId: randomUUID(),
      roundId: s.round!.roundId,
      expectedVersion: s.round!.version,
      cellIndex: 0,
    }

    const reply = await dice.command(who, 'dice.reveal', body)

    expect(await dice.command(who, 'dice.reveal', body)).toEqual(reply)
    s = await command(who, 'dice.sync')
    expect(BigInt(s.balanceMinor)).toBe(initial + 18000n + win)
    expect(s.bonusGrants?.find((g) => g.id === id)).toMatchObject({
      balanceMinor: '0',
      releasedMinor: String(18000n + win),
      wageredMinor: '40000',
      released: true,
    })
    expect(await rows('SELECT id FROM dice_entries WHERE bonus_grant_id=:id', { id })).toHaveLength(
      1,
    )
    await expect(
      command(who, 'dice.start', { stakeMinor: '1000', mines: 1, bonusWalletId: id }),
    ).rejects.toThrow()
  })
  it('rejects foreign, overdrawn and mixed-source bonus stakes without debiting main funds', async () => {
    const who = await player()

    const other = await player()

    const id = await grant(who)

    await rows(
      'UPDATE bonus_grants SET remaining=0,winnings=1000,balance=1000,required=2000 WHERE id=:id RETURNING id',
      { id },
    )
    await expect(
      command(other, 'dice.start', { stakeMinor: '1000', mines: 1, bonusWalletId: id }),
    ).rejects.toThrow()
    await expect(
      command(who, 'dice.start', { stakeMinor: '2000', mines: 1, bonusWalletId: id }),
    ).rejects.toThrow()
    await expect(
      command(who, 'dice.start', {
        stakeMinor: '1000',
        mines: 1,
        bonusWalletId: id,
        bonusGrantId: id,
      }),
    ).rejects.toThrow()

    const s = await command(who, 'dice.sync')

    expect(s.balanceMinor).toBe('1000000')
    expect(s.bonusGrants?.find((g) => g.id === id)?.balanceMinor).toBe('1000')
  })
})
