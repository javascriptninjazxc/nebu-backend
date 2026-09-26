import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Transaction } from 'sequelize'
import { randomUUID } from 'node:crypto'
import { GameAccountService } from './account.service.js'
import { OriginalsRandom, periodWindow } from './random.js'
import { DiceError } from '../dice/errors.js'
import type { DrawDto, DrawRevealDto } from './dto.js'
import type { JackpotDraw, NetworkState, PoolId } from './contracts.js'

type Period = {
  id: string
  pool: PoolId
  amount: string
  total_weight: string
  winner_id: string | null
  paid: boolean
  ends_at: Date
  status: 'OPEN' | 'DRAWN' | 'EMPTY'
}
type Participation = Period & { opened: number; version: number }

@Injectable()
export class NetworkJackpotsService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(GameAccountService) private readonly accounts: GameAccountService,
    @Inject(OriginalsRandom) private readonly random: OriginalsRandom,
  ) {}
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private logger = new Logger(NetworkJackpotsService.name)
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick()
    }, 5000)
    this.timer.unref()
    void this.tick()
  }
  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
    }
  }
  private async tick() {
    if (this.running) {
      return
    }

    this.running = true

    try {
      await this.settleDue()
    } catch {
      this.logger.error('Jackpot draw deferred; persistent periods will be retried')
    } finally {
      this.running = false
    }
  }
  async now(t: Transaction) {
    const [clock] = await this.accounts.rows<{ now: Date }>(
      'SELECT clock_timestamp() AS now',
      {},
      t,
    )

    return new Date(clock.now)
  }
  async contribute(user: string, round: string, stake: string, t: Transaction) {
    // One short global schedule lock gives both pools the same acceptance time and prevents closing across a contribution.
    await this.accounts.rows('SELECT pg_advisory_xact_lock(70419002)', {}, t)

    const now = await this.now(t)

    for (const pool of ['mini', 'mega'] as const) {
      const window = periodWindow(pool, now)

      const contribution = (BigInt(stake) / 100n).toString()

      const [period] = await this.accounts.rows<{ id: string }>(
        `INSERT INTO jackpot_periods(id,pool,starts_at,ends_at) VALUES(:id,:pool,:start,:end)
  ON CONFLICT(pool,starts_at) DO UPDATE SET pool=EXCLUDED.pool RETURNING id`,
        { id: randomUUID(), pool, start: window.start, end: window.end },
        t,
      )

      await this.accounts.rows(
        'INSERT INTO jackpot_contributions(round_id,period_id,user_id,amount,weight) VALUES(:round,:period,:user,:amount,:stake) RETURNING round_id',
        { round, period: period.id, user, amount: contribution, stake },
        t,
      )
      await this.accounts.rows(
        "UPDATE jackpot_periods SET amount=amount+CAST(:amount AS BIGINT),total_weight=total_weight+CAST(:stake AS BIGINT) WHERE id=:id AND status='OPEN' RETURNING id",
        { id: period.id, amount: contribution, stake },
        t,
      )
      await this.accounts.rows(
        `INSERT INTO jackpot_participants(period_id,user_id,weight) VALUES(:period,:user,:stake)
  ON CONFLICT(period_id,user_id) DO UPDATE SET weight=jackpot_participants.weight+EXCLUDED.weight RETURNING user_id`,
        { period: period.id, user, stake },
        t,
      )
    }
  }
  async settleDue() {
    return this.accounts.db.transaction(async (t) => {
      await this.accounts.rows("SET LOCAL lock_timeout='3s'", {}, t)
      await this.accounts.rows("SET LOCAL statement_timeout='5s'", {}, t)

      const [lock] = await this.accounts.rows<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock(70419002) AS locked',
        {},
        t,
      )

      if (!lock.locked) {
        return 0
      }

      const due = await this.accounts.rows<Period>(
        "SELECT * FROM jackpot_periods WHERE status='OPEN' AND ends_at<=clock_timestamp() ORDER BY ends_at,id LIMIT 100 FOR UPDATE",
        {},
        t,
      )

      for (const period of due) {
        if (BigInt(period.total_weight) === 0n) {
          await this.accounts.rows(
            "UPDATE jackpot_periods SET status='EMPTY',drawn_at=NOW() WHERE id=:id RETURNING id",
            { id: period.id },
            t,
          )
          continue
        }

        const participants = await this.accounts.rows<{
          user_id: string
          weight: string
        }>(
          'SELECT user_id,weight FROM jackpot_participants WHERE period_id=:id ORDER BY user_id',
          { id: period.id },
          t,
        )

        const total = participants.reduce((sum, p) => sum + BigInt(p.weight), 0n)

        if (total !== BigInt(period.total_weight)) {
          throw new Error('Jackpot weight mismatch')
        }

        let ticket = this.random.weighted(total)

        let winner: string | undefined

        for (const person of participants) {
          ticket -= BigInt(person.weight)

          if (ticket < 0n) {
            winner = person.user_id
            break
          }
        }

        if (!winner) {
          throw new Error('No winner')
        }

        await this.accounts.rows(
          "UPDATE jackpot_periods SET status='DRAWN',winner_id=:winner,drawn_at=NOW() WHERE id=:id RETURNING id",
          { id: period.id, winner },
          t,
        )
        await this.accounts.rows(
          'INSERT INTO jackpot_outbox(period_id) VALUES(:id) RETURNING id',
          { id: period.id },
          t,
        )
      }

      return due.length
    })
  }
  async notifications(emit: (eventId: string) => void) {
    await this.accounts.db.transaction(async (t) => {
      const rows = await this.accounts.rows<{ id: string }>(
        'SELECT id FROM jackpot_outbox WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED',
        {},
        t,
      )

      for (const row of rows) {
        emit(row.id)
        await this.accounts.rows(
          'UPDATE jackpot_outbox SET published_at=NOW() WHERE id=:id RETURNING id',
          { id: row.id },
          t,
        )
      }
    })
  }
  private present(p: Participation, user: string): JackpotDraw {
    const winner = p.winner_id === user

    return {
      drawId: p.id,
      pool: p.pool,
      amountMinor: p.amount,
      endsAt: new Date(p.ends_at).toISOString(),
      version: p.version,
      cards: [0, 1, 2]
        .filter((i) => Boolean(p.opened & (1 << i)))
        .map((index) => ({
          index,
          symbol: winner ? 'nebi' : (['nebi', 'crystal', 'coin'] as const)[index],
        })),
      result: p.opened !== 7 ? 'pending' : winner ? (p.paid ? 'paid' : 'won') : 'lost',
    }
  }
  async view(user: string, t: Transaction, drawId?: string): Promise<NetworkState> {
    const now = await this.now(t)

    const pools = await Promise.all(
      (['mini', 'mega'] as const).map(async (id) => {
        const window = periodWindow(id, now)

        const [pool] = await this.accounts.rows<{ amount: string }>(
          'SELECT amount FROM jackpot_periods WHERE pool=:pool AND starts_at=:start',
          { pool: id, start: window.start },
          t,
        )

        return {
          id,
          amountMinor: pool?.amount ?? '0',
          endsAt: window.end.toISOString(),
          contributionBasisPoints: 100,
        }
      }),
    )

    // Every participant can reveal the result; only unpaid winners remain after all cards are opened.
    const rows = await this.accounts.rows<Participation>(
      `SELECT p.*,j.opened,j.version FROM jackpot_participants j JOIN jackpot_periods p ON p.id=j.period_id
 WHERE j.user_id=:user AND p.status='DRAWN' AND (j.opened<>7 OR (p.winner_id=:user AND NOT p.paid)) ORDER BY p.ends_at,p.id LIMIT 21`,
      { user },
      t,
    )

    let draw: JackpotDraw | null = null

    if (drawId) {
      const [row] = await this.accounts.rows<Participation>(
        "SELECT p.*,j.opened,j.version FROM jackpot_participants j JOIN jackpot_periods p ON p.id=j.period_id WHERE j.user_id=:user AND p.id=:id AND p.status='DRAWN'",
        { user, id: drawId },
        t,
      )

      if (!row) {
        throw new DiceError('DRAW_NOT_FOUND', 'Розыгрыш не найден.')
      }

      draw = this.present(row, user)
    }

    const [wallet] = await this.accounts.rows<{
      balance: string
      version: number
    }>('SELECT balance,version FROM dice_wallets WHERE user_id=:user', { user }, t)

    return {
      balanceMinor: wallet.balance,
      walletVersion: wallet.version,
      serverTime: now.toISOString(),
      pools,
      pending: rows.slice(0, 20).map((p) => this.present(p, user)),
      hasMore: rows.length > 20,
      draw,
    }
  }
  async action(user: string, event: string, dto: DrawDto, t: Transaction) {
    const [period] = await this.accounts.rows<Period>(
      "SELECT p.* FROM jackpot_periods p JOIN jackpot_participants j ON j.period_id=p.id WHERE p.id=:id AND j.user_id=:user AND p.status='DRAWN' FOR UPDATE OF p",
      { id: dto.drawId, user },
      t,
    )

    if (!period) {
      throw new DiceError('DRAW_NOT_FOUND', 'Розыгрыш не найден.')
    }

    const [participant] = await this.accounts.rows<{
      opened: number
      version: number
    }>(
      'SELECT opened,version FROM jackpot_participants WHERE period_id=:id AND user_id=:user FOR UPDATE',
      { id: dto.drawId, user },
      t,
    )

    if (participant.version !== dto.expectedVersion) {
      throw new DiceError('VERSION_CONFLICT', 'Розыгрыш изменился. Обновляем состояние.')
    }

    if (event === 'jackpots.reveal') {
      const index = (dto as DrawRevealDto).cardIndex

      if (participant.opened & (1 << index)) {
        throw new DiceError('CELL_ALREADY_OPENED', 'Карта уже открыта.')
      }

      await this.accounts.rows(
        'UPDATE jackpot_participants SET opened=opened | :bit,version=version+1 WHERE period_id=:id AND user_id=:user RETURNING version',
        { id: dto.drawId, user, bit: 1 << index },
        t,
      )
    } else {
      if (participant.opened !== 7) {
        throw new DiceError('CLAIM_NOT_READY', 'Сначала открой три карты.')
      }

      if (period.winner_id !== user) {
        throw new DiceError('NOT_WINNER', 'В этом розыгрыше приз получил другой участник.')
      }

      if (!period.paid) {
        await this.accounts.money(user, period.id, period.amount, 'PAYOUT', t, 'jackpot')
        await this.accounts.rows(
          'UPDATE jackpot_periods SET paid=TRUE WHERE id=:id RETURNING id',
          { id: period.id },
          t,
        )
        await this.accounts.rows(
          'UPDATE jackpot_participants SET version=version+1 WHERE period_id=:id AND user_id=:user RETURNING version',
          { id: period.id, user },
          t,
        )
      }
    }

    return this.view(user, t, dto.drawId)
  }
}
