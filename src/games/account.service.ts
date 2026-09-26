import { BonusService } from '../bonuses/bonus.service.js'
import { InjectModel } from '@nestjs/sequelize'
import { DiceWallet, DiceEntry } from '../dice/models.js'
import { Inject, Injectable } from '@nestjs/common'
import { Sequelize } from 'sequelize-typescript'
import { QueryTypes, type Transaction } from 'sequelize'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DiceError } from '../dice/errors.js'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

type Wallet = { balance: string; version: number }

export type Identity = { userId: string; sessionHash: string }

@Injectable()
export class GameAccountService {
  constructor(
    @Inject(BonusService) readonly bonuses: BonusService,
    @Inject(Sequelize) readonly db: Sequelize,
    @InjectModel(DiceWallet) private readonly wallets: typeof DiceWallet,
    @InjectModel(DiceEntry) private readonly entries: typeof DiceEntry,
  ) {}
  rows<T extends object>(
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ): Promise<T[]> {
    return this.db.query<T>(sql, {
      replacements,
      transaction,
      type: QueryTypes.SELECT,
    })
  }
  async session(sessionHash: string, t?: Transaction): Promise<Identity> {
    const [s] = await this.rows<{ userId: string }>(
      'SELECT "userId" FROM auth_sessions WHERE hash=:sessionHash AND "expiresAt">NOW()' +
        (t ? ' FOR SHARE' : ''),
      { sessionHash },
      t,
    )

    if (!s) {
      throw new DiceError('UNAUTHENTICATED', 'Войди в аккаунт заново.')
    }

    return { userId: s.userId, sessionHash }
  }
  async limit(key: string, max: number, seconds: number, transaction?: Transaction) {
    const [row] = await this.rows<{ count: number }>(
      `INSERT INTO dice_limits(key,count,expires_at) VALUES(:key,1,NOW() + :seconds * INTERVAL '1 second')
ON CONFLICT(key) DO UPDATE SET count=CASE WHEN dice_limits.expires_at<=NOW() THEN 1 ELSE dice_limits.count+1 END,
expires_at=CASE WHEN dice_limits.expires_at<=NOW() THEN EXCLUDED.expires_at ELSE dice_limits.expires_at END RETURNING count`,
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

      await this.rows(
        "INSERT INTO dice_tickets(hash,session_hash,expires_at) VALUES(:hash,:session,NOW()+INTERVAL '30 seconds') RETURNING hash",
        { hash: hash(ticket), session: identity.sessionHash },
        t,
      )

      return { ticket, expiresIn: 30 }
    })
  }
  async connect(ticket: unknown, id: string): Promise<Identity> {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
      throw new DiceError('UNAUTHENTICATED', 'Неверный билет.')
    }

    return this.db.transaction(async (t) => {
      const [row] = await this.rows<{ session_hash: string }>(
        'DELETE FROM dice_tickets WHERE hash=:hash AND expires_at>NOW() RETURNING session_hash',
        { hash: hash(ticket) },
        t,
      )

      if (!row) {
        throw new DiceError('UNAUTHENTICATED', 'Билет истёк.')
      }

      const who = await this.session(row.session_hash, t)

      await this.rows(
        'SELECT pg_advisory_xact_lock(hashtextextended(:user, 70419))',
        { user: who.userId },
        t,
      )
      await this.rows(
        'DELETE FROM dice_connections WHERE user_id=:user AND expires_at<=NOW() RETURNING id',
        { user: who.userId },
        t,
      )

      const existing = await this.rows(
        'SELECT id FROM dice_connections WHERE user_id=:user',
        { user: who.userId },
        t,
      )

      if (existing.length >= 4) {
        throw new DiceError('RATE_LIMITED', 'Открыто слишком много игровых вкладок.')
      }

      await this.rows(
        "INSERT INTO dice_connections(id,user_id,session_hash,expires_at) VALUES(:id,:user,:session,NOW()+INTERVAL '90 seconds') RETURNING id",
        { id, user: who.userId, session: who.sessionHash },
        t,
      )

      return who
    })
  }
  async heartbeat(id: string, identity: Identity) {
    await this.session(identity.sessionHash)

    const rows = await this.rows(
      "UPDATE dice_connections SET expires_at=NOW()+INTERVAL '90 seconds' WHERE id=:id AND expires_at>NOW() RETURNING id",
      { id },
    )

    if (!rows.length) {
      throw new DiceError('UNAUTHENTICATED', 'Соединение истекло.')
    }
  }
  async disconnect(id: string) {
    await this.rows('DELETE FROM dice_connections WHERE id=:id RETURNING id', {
      id,
    })
  }
  async cleanup() {
    await this.rows('DELETE FROM dice_connections WHERE expires_at<NOW() RETURNING id')
    await this.rows('DELETE FROM dice_tickets WHERE expires_at<NOW() RETURNING hash')
    await this.rows(
      "DELETE FROM dice_limits WHERE expires_at<NOW()-INTERVAL '1 hour' RETURNING key",
    )
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

    const [w] = await this.rows<Wallet>(
      'UPDATE dice_wallets SET balance=balance+CAST(:delta AS BIGINT),version=version+1 WHERE user_id=:user RETURNING balance,version',
      { user, delta },
      t,
    )

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
