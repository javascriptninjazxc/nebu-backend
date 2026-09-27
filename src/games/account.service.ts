import { Inject, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { randomBytes, randomUUID } from 'node:crypto'
import { literal, Op, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import { AuthSession } from '../auth/models.js'
import { digest as hash } from '../auth/password.utils.js'
import { BonusService } from '../bonuses/bonus.service.js'
import { DiceConnectionsModel } from '../dice/dice-connections.model.js'
import { DiceLimitsModel } from '../dice/dice-limits.model.js'
import { DiceTicketsModel } from '../dice/dice-tickets.model.js'
import { DiceError } from '../dice/errors.js'
import { DiceEntry, DiceWallet } from '../dice/models.js'
import { GameAccountRepository } from './account.repository.js'
import type { Identity, Wallet } from './account.types.js'

@Injectable()
export class GameAccountService {
  constructor(
    @Inject(GameAccountRepository) private readonly repository: GameAccountRepository,
    @Inject(BonusService) readonly bonuses: BonusService,
    @Inject(Sequelize) readonly db: Sequelize,
    @InjectModel(DiceWallet) private readonly wallets: typeof DiceWallet,
    @InjectModel(DiceEntry) private readonly entries: typeof DiceEntry,
  ) {}

  async session(sessionHash: string, t?: Transaction): Promise<Identity> {
    const s = await AuthSession.findOne({
      attributes: ['userId'],
      where: { hash: sessionHash, expiresAt: { [Op.gt]: literal('NOW()') } },
      transaction: t,
      lock: t ? Transaction.LOCK.SHARE : undefined,
      raw: true,
    })

    if (!s) {
      throw new DiceError('UNAUTHENTICATED', 'Войди в аккаунт заново.')
    }

    return { userId: s.userId, sessionHash }
  }

  async limit(key: string, max: number, seconds: number, transaction?: Transaction) {
    const [row] = await this.repository.incrementActionLimit(
      { key: hash(key), seconds },
      transaction,
    )

    if (row.count > max) {
      throw new DiceError('RATE_LIMITED', 'Слишком много действий. Попробуй чуть позже.', true)
    }
  }

  async ticket(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new DiceError('UNAUTHENTICATED', 'Войди в аккаунт.')
    }

    return this.db.transaction(async (t) => {
      const identity = await this.session(hash(token), t)

      await this.limit('ticket:' + identity.userId, 30, 60, t)

      const ticket = randomBytes(32).toString('base64url')

      await DiceTicketsModel.create(
        { hash: hash(ticket), session_hash: identity.sessionHash },
        { transaction: t },
      )

      return { ticket, expiresIn: 30 }
    })
  }

  async connect(ticket: unknown, id: string): Promise<Identity> {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
      throw new DiceError('UNAUTHENTICATED', 'Неверный билет.')
    }

    return this.db.transaction(async (t) => {
      const [row] = await this.repository.consumeTicket({ hash: hash(ticket) }, t)

      if (!row) {
        throw new DiceError('UNAUTHENTICATED', 'Билет истёк.')
      }

      const who = await this.session(row.session_hash, t)

      await this.repository.lockAccount({ user: who.userId }, t)
      await DiceConnectionsModel.destroy({
        where: {
          [Op.and]: [{ user_id: who.userId }, { expires_at: { [Op.lte]: literal('NOW()') } }],
        },
        transaction: t,
      })

      const existing = await DiceConnectionsModel.findAll({
        attributes: ['id'],
        where: { user_id: who.userId },
        transaction: t,
        raw: true,
      })

      if (existing.length >= 4) {
        throw new DiceError('RATE_LIMITED', 'Открыто слишком много игровых вкладок.')
      }

      await DiceConnectionsModel.create(
        { id, user_id: who.userId, session_hash: who.sessionHash },
        { transaction: t },
      )

      return who
    })
  }

  async heartbeat(id: string, identity: Identity) {
    await this.session(identity.sessionHash)

    const rows = await DiceConnectionsModel.update(
      { expires_at: literal("NOW() + INTERVAL '90 seconds'") },
      { where: { id, expires_at: { [Op.gt]: literal('NOW()') } }, returning: true },
    ).then(([, rows]) => rows)

    if (!rows.length) {
      throw new DiceError('UNAUTHENTICATED', 'Соединение истекло.')
    }
  }

  async disconnect(id: string) {
    await DiceConnectionsModel.destroy({ where: { id: id }, transaction: undefined })
  }

  async cleanup() {
    await DiceConnectionsModel.destroy({
      where: { expires_at: { [Op.lt]: literal('NOW()') } },
      transaction: undefined,
    })
    await DiceTicketsModel.destroy({
      where: { expires_at: { [Op.lt]: literal('NOW()') } },
      transaction: undefined,
    })
    await DiceLimitsModel.destroy({
      where: { expires_at: { [Op.lt]: literal("NOW() - INTERVAL '1 hour'") } },
    })
  }

  async wallet(user: string, t: Transaction): Promise<Wallet> {
    let wallet = await this.wallets.findByPk(user, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    })

    if (!wallet) {
      wallet = await this.wallets.create(
        { userId: user, balance: '0', version: 1 },
        { transaction: t },
      )
    }

    return { balance: String(wallet.balance), version: wallet.version }
  }

  async money(
    user: string,
    round: string,
    delta: string,
    reason: 'STAKE' | 'PAYOUT',
    t: Transaction,
    source: 'dice' | 'original' | 'jackpot' = 'dice',
  ) {
    if (
      reason === 'PAYOUT' &&
      source !== 'jackpot' &&
      (await this.bonuses.award(user, round, delta, t))
    ) {
      return
    }

    const [w] = await this.repository.creditWallet({ user, delta }, t)

    await this.entries.create(
      {
        id: randomUUID(),
        userId: user,
        roundId: source === 'dice' ? round : null,
        gameRoundId: source === 'original' ? round : null,
        jackpotPeriodId: source === 'jackpot' ? round : null,
        reason,
        delta,
        balanceAfter: w.balance,
      },
      { transaction: t },
    )
  }
}
