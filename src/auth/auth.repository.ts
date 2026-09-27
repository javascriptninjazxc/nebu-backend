import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, type Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type {
  AuthIncrementLoginLimitParams,
  AuthIncrementLoginLimitRow,
} from './auth.repository.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class AuthRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  incrementLoginLimit(
    params: AuthIncrementLoginLimitParams,
    transaction?: Transaction,
  ): Promise<AuthIncrementLoginLimitRow[]> {
    return this.db.query<AuthIncrementLoginLimitRow>(
      `
        INSERT INTO auth_limits (key, count, expires_at)
        VALUES (:key, 1, NOW() + INTERVAL '1 minute')
        ON CONFLICT (key)
        DO UPDATE SET count = CASE WHEN auth_limits.expires_at <= NOW() THEN 1 ELSE auth_limits.count + 1 END, expires_at = CASE WHEN auth_limits.expires_at <= NOW() THEN NOW() + INTERVAL '1 minute' ELSE auth_limits.expires_at END
        RETURNING count
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }
}
