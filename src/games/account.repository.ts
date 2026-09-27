import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type {
  GameAccountConsumeTicketParams,
  GameAccountConsumeTicketRow,
  GameAccountCreditWalletParams,
  GameAccountIncrementActionLimitParams,
  GameAccountIncrementActionLimitRow,
  GameAccountLockAccountParams,
} from './account.repository.types.js'
import type { Wallet } from './account.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class GameAccountRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  incrementActionLimit(
    params: GameAccountIncrementActionLimitParams,
    transaction?: Transaction,
  ): Promise<GameAccountIncrementActionLimitRow[]> {
    return this.db.query<GameAccountIncrementActionLimitRow>(
      `
        INSERT INTO dice_limits(key,count,expires_at)
        VALUES(:key,1,NOW() + :seconds * INTERVAL '1 second')
        ON CONFLICT(key)
        DO UPDATE SET count=CASE WHEN dice_limits.expires_at<=NOW() THEN 1 ELSE dice_limits.count+1 END, expires_at=CASE WHEN dice_limits.expires_at<=NOW() THEN EXCLUDED.expires_at ELSE dice_limits.expires_at END
        RETURNING count
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  consumeTicket(
    params: GameAccountConsumeTicketParams,
    transaction?: Transaction,
  ): Promise<GameAccountConsumeTicketRow[]> {
    return this.db.query<GameAccountConsumeTicketRow>(
      'DELETE FROM dice_tickets WHERE hash=:hash AND expires_at>NOW() RETURNING session_hash',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  lockAccount(
    params: GameAccountLockAccountParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'SELECT pg_advisory_xact_lock(hashtextextended(:user, 70419))',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditWallet(
    params: GameAccountCreditWalletParams,
    transaction?: Transaction,
  ): Promise<Wallet[]> {
    return this.db.query<Wallet>(
      `
        UPDATE dice_wallets
        SET balance=balance+CAST(:delta AS BIGINT),version=version+1
        WHERE user_id=:user
        RETURNING balance,version
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }
}
