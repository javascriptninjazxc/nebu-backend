import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type { DiceLockAccountParams } from './dice.repository.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class DiceRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  setLockTimeout(transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>("SET LOCAL lock_timeout = '3s'", {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  setStatementTimeout(transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>("SET LOCAL statement_timeout = '5s'", {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  lockAccount(
    params: DiceLockAccountParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'SELECT pg_advisory_xact_lock(hashtextextended(:user, 70419))',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }
}
