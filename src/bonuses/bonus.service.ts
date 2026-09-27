import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { col, literal, Op, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import { AuthSession } from '../auth/models.js'
import { DiceError } from '../dice/errors.js'
import { DiceEntry, DiceWallet } from '../dice/models.js'
import { BonusBetsModel } from './bonus-bets.model.js'
import { BonusDrawsModel } from './bonus-draws.model.js'
import { BonusGrantsModel } from './bonus-grants.model.js'
import { BonusRoundsModel } from './bonus-rounds.model.js'
import { BonusSettingsModel } from './bonus-settings.model.js'
import { BONUS_PRIZES } from './bonus.constants.js'
import { BonusRepository } from './bonus.repository.js'
import type { Settings } from './bonus.types.js'
import type { Draw } from './bonus.types.js'
import { choosePrize, guestDigest } from './bonus.utils.js'
import type { BonusGrant } from './contracts.js'

@Injectable()
export class BonusService {
  constructor(
    @Inject(BonusRepository) private readonly repository: BonusRepository,
    @Inject(Sequelize) readonly db: Sequelize,
  ) {}

  async identity(auth?: string) {
    if (!auth) {
      return null
    }

    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) {
      throw new UnauthorizedException()
    }

    const s = await AuthSession.findOne({
      attributes: ['userId'],
      where: {
        [Op.and]: [
          { hash: guestDigest(auth.slice(7)) },
          { expiresAt: { [Op.gt]: literal('NOW()') } },
        ],
      },
      transaction: undefined,
      raw: true,
    })

    if (!s) {
      throw new UnauthorizedException()
    }

    return s.userId
  }

  async lock(user: string, t: Transaction) {
    await this.repository.lockAccount({ user }, t)
  }

  async guestLock(guest: string, t: Transaction) {
    await this.repository.lockGuest({ guest }, t)
  }

  async period(t?: Transaction) {
    const [p] = await this.repository.weekWindow(t)

    return p
  }

  async settings(t?: Transaction): Promise<Settings> {
    return (await BonusSettingsModel.findAll({ where: { id: 1 }, transaction: t, raw: true }))[0]
  }

  async deposits(user: string, t?: Transaction) {
    return (await this.repository.weeklyDeposits({ user }, t))[0].total
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

    const draws = await BonusDrawsModel.findAll({
      where: user
        ? { user_id: user, [Op.or]: [{ mode: 'welcome' }, { period: period.period }] }
        : { guest_hash: guest, user_id: null },
      raw: true,
    })

    const guestClaimed =
      !user &&
      (
        await BonusDrawsModel.count({
          where: { guest_hash: guest, user_id: { [Op.ne]: null } },
        }).then((count) => [{ used: count > 0 }])
      )[0].used

    const [wallet] = user
      ? await DiceWallet.findAll({
          attributes: ['balance', 'version'],
          where: { userId: user },
          transaction: undefined,
          raw: true,
        })
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
    const grants = await BonusGrantsModel.findAll({
      where: { user_id: user },
      order: [
        ['created_at', 'ASC'],
        ['id', 'ASC'],
      ],
      transaction: t,
      raw: true,
    })

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

      const old = await BonusDrawsModel.findOne({
        where: user ? { user_id: user, mode, period } : { guest_hash: guest },
        transaction: t,
        raw: true,
      })

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

      const [draw] = await BonusDrawsModel.create(
        {
          id: randomUUID(),
          user_id: user,
          guest_hash: user ? null : guest,
          mode,
          period,
          prize_index: index,
          game: prize.game,
          rounds: prize.rounds,
          stake: prize.stake,
          wager_multiplier: settings.wager_multiplier,
          round_days: settings.round_days,
        },
        { transaction: t },
      ).then((row) => [row.get({ plain: true })])

      return this.publicDraw(draw)
    })
  }

  async bindGuest(user: string, guest: string | undefined, t: Transaction) {
    if (!guest) {
      return
    }

    await this.guestLock(guest, t)

    const draw = await BonusDrawsModel.findOne({
      where: { guest_hash: guest },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
      raw: true,
    })

    if (!draw || draw.user_id) {
      return
    }

    await BonusDrawsModel.update({ user_id: user }, { where: { id: draw.id }, transaction: t })
    await this.grant(user, draw.id, t)
  }

  async grant(user: string, id: string, t: Transaction) {
    const d = await BonusDrawsModel.findOne({
      where: { id: id, user_id: user },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
      raw: true,
    })

    if (!d) {
      throw new ForbiddenException('Приз не найден.')
    }

    if (d.claimed_at) {
      return
    }

    await this.repository.createGrant(
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
    await BonusDrawsModel.update(
      { claimed_at: literal('NOW()') },
      { where: { id: id }, transaction: t },
    )
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
    const g = await BonusGrantsModel.findOne({
      where: {
        [Op.and]: [
          { id: id },
          { user_id: user },
          { expires_at: { [Op.gt]: literal('NOW()') } },
          { remaining: { [Op.gt]: 0 } },
          { released: false },
        ],
      },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
      raw: true,
    })

    if (!g || g.game !== game || g.stake !== stake) {
      throw new DiceError('VALIDATION_ERROR', 'Бесплатный раунд недоступен или ставка изменена.')
    }

    await BonusGrantsModel.update(
      { remaining: literal('"remaining"-1') },
      { where: { id: id }, transaction: t },
    )
    await BonusRoundsModel.create(
      { round_id: round, grant_id: id, user_id: user, source: source },
      { transaction: t },
    )
  }

  async consumeBalance(user: string, id: string, stake: string, round: string, t: Transaction) {
    const g = await BonusGrantsModel.findOne({
      where: { id: id, user_id: user, released: false },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
      raw: true,
    })

    if (!g || BigInt(g.balance) < BigInt(stake)) {
      throw new DiceError('INSUFFICIENT_FUNDS', 'Недостаточно средств на бонусном балансе.')
    }

    await this.repository.debitGrant({ id, stake }, t)
    await BonusBetsModel.create(
      { round_id: round, grant_id: id, user_id: user, stake: stake },
      { transaction: t },
    )
  }

  async award(user: string, round: string, amount: string, t: Transaction) {
    const bet = await BonusBetsModel.findOne({
      attributes: ['grant_id'],
      where: { round_id: round, user_id: user },
      transaction: t,
      raw: true,
    })

    if (bet) {
      await this.repository.creditBonusBet({ round, amount }, t)
      await this.repository.creditGrantBalance({ id: bet.grant_id, amount }, t)

      return true
    }

    const r = await BonusRoundsModel.findOne({
      attributes: ['grant_id'],
      where: { round_id: round, user_id: user },
      transaction: t,
      raw: true,
    })

    if (!r) {
      return false
    }

    await this.repository.creditBonusRound({ round, amount }, t)
    await this.repository.creditGrantAndRequirement({ id: r.grant_id, amount }, t)

    return true
  }

  async settled(user: string, round: string, source: 'dice' | 'original', t: Transaction) {
    const [bet] = await BonusBetsModel.update(
      { settled: true },
      {
        where: { round_id: round, user_id: user, settled: false },
        transaction: t,
        returning: true,
      },
    ).then(([, rows]) => rows.map((row) => row.get({ plain: true })))

    if (bet) {
      await this.repository.applyCappedTurnover({ id: bet.grant_id, stake: bet.stake }, t)
    }

    const free = await BonusRoundsModel.update(
      { settled: true },
      {
        where: { round_id: round, user_id: user },
        transaction: t,
        returning: true,
      },
    ).then(([, rows]) => rows.map((row) => row.get({ plain: true })))

    if (!free.length) {
      const stake = await DiceEntry.findOne({
        attributes: ['delta'],
        where: {
          userId: user,
          [source === 'dice' ? 'roundId' : 'gameRoundId']: round,
          reason: 'STAKE',
        },
        transaction: t,
        raw: true,
      })

      if (stake) {
        const added = await this.repository.claimTurnover(
          { round, user, stake: (-BigInt(stake.delta)).toString() },
          t,
        )

        if (added.length) {
          let left = -BigInt(stake.delta)

          const grants = await BonusGrantsModel.findAll({
            where: { user_id: user, released: false, required: { [Op.gt]: col('wagered') } },
            order: [
              ['created_at', 'ASC'],
              ['id', 'ASC'],
            ],
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
            raw: true,
          })

          for (const g of grants) {
            const need = BigInt(g.required) - BigInt(g.wagered)

            const add = left < need ? left : need

            if (add <= 0n) {
              break
            }

            await this.repository.applyTurnover({ id: g.id, add: add.toString() }, t)
            left -= add
          }
        }
      }
    }

    await this.release(user, t)
  }

  async release(user: string, t: Transaction) {
    const grants = await this.repository.lockReleasableGrants({ user }, t)

    for (const g of grants) {
      if (BigInt(g.balance) > 0n) {
        const [w] = await this.repository.creditWallet({ user, amount: g.balance }, t)

        if (!w) {
          continue
        }

        await DiceEntry.create(
          {
            id: randomUUID(),
            userId: user,
            reason: 'BONUS_RELEASE',
            delta: g.balance,
            balanceAfter: w.balance,
            bonusGrantId: g.id,
          },
          { transaction: t },
        )
      }

      await BonusGrantsModel.update(
        { released: true, released_amount: col('balance'), balance: '0' },
        { where: { id: g.id }, transaction: t },
      )
    }
  }
}
