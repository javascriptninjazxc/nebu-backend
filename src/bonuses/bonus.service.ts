import type { BonusGrant } from './contracts.js'
import { DiceError } from '../dice/errors.js'
import { Inject, Injectable, ForbiddenException } from '@nestjs/common'
import { Sequelize } from 'sequelize-typescript'
import { QueryTypes, type Transaction } from 'sequelize'
import { createHash, randomInt, randomUUID } from 'node:crypto'

export const BONUS_PRIZES = [
  { game: 'forest', rounds: 5, stake: '1000', weight: 30 },
  { game: 'caches', rounds: 10, stake: '1000', weight: 20 },
  { game: 'dice', rounds: 5, stake: '2000', weight: 15 },
  { game: 'chest', rounds: 10, stake: '2000', weight: 10 },
  { game: 'forest', rounds: 5, stake: '3000', weight: 12 },
  { game: 'caches', rounds: 5, stake: '5000', weight: 8 },
  { game: 'dice', rounds: 3, stake: '10000', weight: 3 },
  { game: 'chest', rounds: 5, stake: '10000', weight: 2 },
] as const
type Settings = {
  wager_multiplier: string
  round_days: number
  weekly_deposit_minor: string
}
type Draw = {
  id: string
  user_id: string | null
  prize_index: number
  game: string
  rounds: number
  stake: string
  wager_multiplier: string
  round_days: number
  claimed_at: Date | null
  mode: string
}
type Grant = {
  id: string
  game: string
  stake: string
  remaining: number
  expires_at: Date
  wager_multiplier: string
  winnings: string
  balance: string
  released_amount: string
  required: string
  wagered: string
  released: boolean
}

export const guestDigest = (token: string) => createHash('sha256').update(token).digest('hex')

export function choosePrize(value = randomInt(100)) {
  for (const [i, p] of BONUS_PRIZES.entries()) {
    value -= p.weight

    if (value < 0) {
      return i
    }
  }

  throw new Error('Invalid prize roll')
}

@Injectable()
export class BonusService {
  constructor(@Inject(Sequelize) readonly db: Sequelize) {}
  rows<T extends object>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ) {
    return this.db.query<T>(sql, {
      replacements,
      transaction,
      type: QueryTypes.SELECT,
    })
  }
  async lock(user: string, t: Transaction) {
    await this.rows('SELECT pg_advisory_xact_lock(hashtextextended(:user,70419))', { user }, t)
  }
  async guestLock(guest: string, t: Transaction) {
    await this.rows('SELECT pg_advisory_xact_lock(hashtextextended(:guest,70420))', { guest }, t)
  }
  async period(t?: Transaction) {
    const [p] = await this.rows<{ period: string; next: string }>(
      `SELECT to_char(date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow'),'YYYY-MM-DD') AS period, (date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 week') AT TIME ZONE 'Europe/Moscow' AS next`,
      {},
      t,
    )

    return p
  }
  async settings(t?: Transaction) {
    return (await this.rows<Settings>('SELECT * FROM bonus_settings WHERE id=1', {}, t))[0]
  }
  async deposits(user: string, t?: Transaction) {
    return (
      await this.rows<{ total: string }>(
        `SELECT COALESCE(SUM(amount_minor),0)::TEXT total FROM confirmed_deposits WHERE user_id=:user AND reversed_at IS NULL AND confirmed_at>=date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' AND confirmed_at<=NOW()`,
        { user },
        t,
      )
    )[0].total
  }
  publicDraw(d?: Draw) {
    return d
      ? {
          id: d.id,
          index: d.prize_index,
          game: d.game,
          rounds: d.rounds,
          stakeMinor: d.stake,
          wagerMultiplier: d.wager_multiplier,
          claimed: Boolean(d.claimed_at),
          mode: d.mode,
        }
      : null
  }
  async status(user: string | null, guest: string) {
    // Reconcile expired packages without requiring another paid game.
    if (user) {
      await this.db.transaction(async (t) => {
        await this.lock(user, t)
        await this.release(user, t)
      })
    }

    const settings = await this.settings()

    const period = await this.period()

    const draws = await this.rows<Draw>(
      user
        ? `SELECT * FROM bonus_draws WHERE user_id=:user AND (mode='welcome' OR period=:period)`
        : 'SELECT * FROM bonus_draws WHERE guest_hash=:guest AND user_id IS NULL',
      { user, guest, period: period.period },
    )

    const guestClaimed =
      !user &&
      (
        await this.rows<{ used: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM bonus_draws WHERE guest_hash=:guest AND user_id IS NOT NULL) AS used',
          { guest },
        )
      )[0].used

    const [wallet] = user
      ? await this.rows<{ balance: string; version: number }>(
          'SELECT balance,version FROM dice_wallets WHERE user_id=:user',
          { user },
        )
      : []

    return {
      guestClaimed,
      mainBalanceMinor: wallet?.balance ?? '0',
      walletVersion: wallet?.version ?? 0,
      welcome: this.publicDraw(draws.find((d) => d.mode === 'welcome')),
      weekly: this.publicDraw(draws.find((d) => d.mode === 'weekly')),
      depositedMinor: user ? await this.deposits(user) : '0',
      weeklyDepositMinor: settings.weekly_deposit_minor,
      nextWeek: period.next,
      wagerMultiplier: settings.wager_multiplier,
      roundDays: settings.round_days,
      grants: user ? await this.grants(user) : [],
    }
  }
  async grants(user: string, t?: Transaction): Promise<BonusGrant[]> {
    const grants = await this.rows<Grant>(
      'SELECT * FROM bonus_grants WHERE user_id=:user ORDER BY created_at,id',
      { user },
      t,
    )

    return grants.map((g) => ({
      id: g.id,
      game: g.game,
      stakeMinor: g.stake,
      remaining: g.remaining,
      expiresAt: new Date(g.expires_at).toISOString(),
      winningsMinor: g.winnings,
      balanceMinor: g.balance,
      releasedMinor: g.released_amount,
      requiredMinor: g.required,
      wageredMinor: g.wagered,
      wagerMultiplier: g.wager_multiplier,
      released: g.released,
    }))
  }
  async spin(user: string | null, guest: string, mode: 'welcome' | 'weekly') {
    return this.db.transaction(async (t) => {
      if (user) {
        await this.lock(user, t)
      } else {
        if (mode !== 'welcome') {
          throw new ForbiddenException('Войди в аккаунт.')
        }

        await this.guestLock(guest, t)
      }

      const period = mode === 'welcome' ? 'welcome' : (await this.period(t)).period

      const [old] = await this.rows<Draw>(
        user
          ? 'SELECT * FROM bonus_draws WHERE user_id=:user AND mode=:mode AND period=:period'
          : 'SELECT * FROM bonus_draws WHERE guest_hash=:guest',
        { user, guest, mode, period },
        t,
      )

      if (old) {
        if (!user && old.user_id) {
          throw new ForbiddenException('Этот подарок уже получен. Войди в аккаунт.')
        }

        return this.publicDraw(old)
      }

      const settings = await this.settings(t)

      if (
        mode === 'weekly' &&
        BigInt(await this.deposits(user!, t)) < BigInt(settings.weekly_deposit_minor)
      ) {
        throw new ForbiddenException('Недостаточно подтверждённых пополнений за неделю.')
      }

      const index = choosePrize()

      const prize = BONUS_PRIZES[index]

      const [draw] = await this.rows<Draw>(
        `INSERT INTO bonus_draws(id,user_id,guest_hash,mode,period,prize_index,game,rounds,stake,wager_multiplier,round_days) VALUES(:id,:user,:guest,:mode,:period,:index,:game,:rounds,:stake,:multiplier,:days) RETURNING *`,
        {
          id: randomUUID(),
          user,
          guest: user ? null : guest,
          mode,
          period,
          index,
          ...prize,
          multiplier: settings.wager_multiplier,
          days: settings.round_days,
        },
        t,
      )

      return this.publicDraw(draw)
    })
  }
  async bindGuest(user: string, guest: string | undefined, t: Transaction) {
    if (!guest) {
      return
    }

    await this.guestLock(guest, t)

    const [draw] = await this.rows<Draw>(
      'SELECT * FROM bonus_draws WHERE guest_hash=:guest FOR UPDATE',
      { guest },
      t,
    )

    if (!draw || draw.user_id) {
      return
    }

    await this.rows(
      'UPDATE bonus_draws SET user_id=:user WHERE id=:id RETURNING id',
      { user, id: draw.id },
      t,
    )
    await this.grant(user, draw.id, t)
  }
  async grant(user: string, id: string, t: Transaction) {
    const [d] = await this.rows<Draw>(
      'SELECT * FROM bonus_draws WHERE id=:id AND user_id=:user FOR UPDATE',
      { id, user },
      t,
    )

    if (!d) {
      throw new ForbiddenException('Приз не найден.')
    }

    if (d.claimed_at) {
      return
    }

    await this.rows(
      `INSERT INTO bonus_grants(id,user_id,game,stake,remaining,expires_at,wager_multiplier) VALUES(:id,:user,:game,:stake,:rounds,NOW() + CAST(:days AS INTEGER) * INTERVAL '1 day',:multiplier) RETURNING id`,
      {
        id,
        user,
        game: d.game,
        stake: d.stake,
        rounds: d.rounds,
        days: d.round_days,
        multiplier: d.wager_multiplier,
      },
      t,
    )
    await this.rows('UPDATE bonus_draws SET claimed_at=NOW() WHERE id=:id RETURNING id', { id }, t)
  }
  async claim(user: string, id: string) {
    await this.db.transaction(async (t) => {
      await this.lock(user, t)
      await this.grant(user, id, t)
    })
  }
  async consume(
    user: string,
    id: string,
    game: string,
    stake: string,
    round: string,
    source: 'dice' | 'original',
    t: Transaction,
  ) {
    const [g] = await this.rows<Grant>(
      'SELECT * FROM bonus_grants WHERE id=:id AND user_id=:user AND expires_at>NOW() AND remaining>0 AND NOT released FOR UPDATE',
      { id, user },
      t,
    )

    if (!g || g.game !== game || g.stake !== stake) {
      throw new DiceError('VALIDATION_ERROR', 'Бесплатный раунд недоступен или ставка изменена.')
    }

    await this.rows(
      'UPDATE bonus_grants SET remaining=remaining-1 WHERE id=:id RETURNING id',
      { id },
      t,
    )
    await this.rows(
      'INSERT INTO bonus_rounds(round_id,grant_id,user_id,source) VALUES(:round,:id,:user,:source) RETURNING round_id',
      { round, id, user, source },
      t,
    )
  }
  async consumeBalance(user: string, id: string, stake: string, round: string, t: Transaction) {
    const [g] = await this.rows<Grant>(
      'SELECT * FROM bonus_grants WHERE id=:id AND user_id=:user AND NOT released FOR UPDATE',
      { id, user },
      t,
    )

    if (!g || BigInt(g.balance) < BigInt(stake)) {
      throw new DiceError('INSUFFICIENT_FUNDS', 'Недостаточно средств на бонусном балансе.')
    }

    await this.rows(
      'UPDATE bonus_grants SET balance=balance-CAST(:stake AS BIGINT) WHERE id=:id RETURNING id',
      { id, stake },
      t,
    )
    await this.rows(
      'INSERT INTO bonus_bets(round_id,grant_id,user_id,stake) VALUES(:round,:id,:user,:stake) RETURNING round_id',
      { round, id, user, stake },
      t,
    )
  }
  async award(user: string, round: string, amount: string, t: Transaction) {
    const [bet] = await this.rows<{ grant_id: string }>(
      'SELECT grant_id FROM bonus_bets WHERE round_id=:round AND user_id=:user',
      { round, user },
      t,
    )

    if (bet) {
      await this.rows(
        'UPDATE bonus_bets SET won_minor=won_minor+CAST(:amount AS BIGINT) WHERE round_id=:round RETURNING round_id',
        { round, amount },
        t,
      )
      await this.rows(
        'UPDATE bonus_grants SET balance=balance+CAST(:amount AS BIGINT) WHERE id=:id RETURNING id',
        { id: bet.grant_id, amount },
        t,
      )

      return true
    }

    const [r] = await this.rows<{ grant_id: string }>(
      'SELECT grant_id FROM bonus_rounds WHERE round_id=:round AND user_id=:user',
      { round, user },
      t,
    )

    if (!r) {
      return false
    }

    await this.rows(
      'UPDATE bonus_rounds SET won_minor=won_minor+CAST(:amount AS BIGINT) WHERE round_id=:round RETURNING round_id',
      { round, amount },
      t,
    )
    await this.rows(
      'UPDATE bonus_grants SET balance=balance+CAST(:amount AS BIGINT),winnings=winnings+CAST(:amount AS BIGINT),required=CEIL((winnings+CAST(:amount AS BIGINT))*wager_multiplier) WHERE id=:id RETURNING id',
      { id: r.grant_id, amount },
      t,
    )

    return true
  }
  async settled(user: string, round: string, source: 'dice' | 'original', t: Transaction) {
    const [bet] = await this.rows<{ grant_id: string; stake: string }>(
      'UPDATE bonus_bets SET settled=TRUE WHERE round_id=:round AND user_id=:user AND NOT settled RETURNING grant_id,stake',
      { round, user },
      t,
    )

    if (bet) {
      await this.rows(
        'UPDATE bonus_grants SET wagered=LEAST(required,wagered+CAST(:stake AS BIGINT)) WHERE id=:id RETURNING id',
        { id: bet.grant_id, stake: bet.stake },
        t,
      )
    }

    const free = await this.rows(
      'UPDATE bonus_rounds SET settled=TRUE WHERE round_id=:round AND user_id=:user RETURNING round_id',
      { round, user },
      t,
    )

    if (!free.length) {
      const [stake] = await this.rows<{ delta: string }>(
        `SELECT delta FROM dice_entries WHERE user_id=:user AND ${source === 'dice' ? 'round_id' : 'game_round_id'}=:round AND reason='STAKE'`,
        { user, round },
        t,
      )

      if (stake) {
        const added = await this.rows(
          'INSERT INTO bonus_turnover(round_id,user_id,stake) VALUES(:round,:user,:stake) ON CONFLICT DO NOTHING RETURNING round_id',
          { round, user, stake: (-BigInt(stake.delta)).toString() },
          t,
        )

        if (added.length) {
          let left = -BigInt(stake.delta)

          const grants = await this.rows<Grant>(
            'SELECT * FROM bonus_grants WHERE user_id=:user AND NOT released AND required>wagered ORDER BY created_at,id FOR UPDATE',
            { user },
            t,
          )

          for (const g of grants) {
            const need = BigInt(g.required) - BigInt(g.wagered)

            const add = left < need ? left : need

            if (add <= 0n) {
              break
            }

            await this.rows(
              'UPDATE bonus_grants SET wagered=wagered+CAST(:add AS BIGINT) WHERE id=:id RETURNING id',
              { id: g.id, add: add.toString() },
              t,
            )
            left -= add
          }
        }
      }
    }

    await this.release(user, t)
  }
  async release(user: string, t: Transaction) {
    const grants = await this.rows<Grant>(
      `SELECT * FROM bonus_grants g WHERE user_id=:user AND NOT released AND required<=wagered AND (remaining=0 OR expires_at<=NOW()) AND NOT EXISTS(SELECT 1 FROM bonus_rounds r WHERE r.grant_id=g.id AND NOT settled) AND NOT EXISTS(SELECT 1 FROM bonus_bets b WHERE b.grant_id=g.id AND NOT b.settled) FOR UPDATE`,
      { user },
      t,
    )

    for (const g of grants) {
      if (BigInt(g.balance) > 0n) {
        const [w] = await this.rows<{ balance: string }>(
          'UPDATE dice_wallets SET balance=balance+CAST(:amount AS BIGINT),version=version+1 WHERE user_id=:user RETURNING balance',
          { user, amount: g.balance },
          t,
        )

        if (!w) {
          continue
        }

        await this.rows(
          `INSERT INTO dice_entries(id,user_id,reason,delta,balance_after,bonus_grant_id) VALUES(:id,:user,'BONUS_RELEASE',:amount,:balance,:grant) RETURNING id`,
          {
            id: randomUUID(),
            user,
            amount: g.balance,
            balance: w.balance,
            grant: g.id,
          },
          t,
        )
      }

      await this.rows(
        'UPDATE bonus_grants SET released=TRUE,released_amount=balance,balance=0 WHERE id=:id RETURNING id',
        { id: g.id },
        t,
      )
    }
  }
}
