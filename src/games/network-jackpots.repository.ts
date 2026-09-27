import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type {
  NetworkJackpotsClockRow,
  NetworkJackpotsContributeToParticipantParams,
  NetworkJackpotsContributeToPeriodParams,
  NetworkJackpotsEnsurePeriodParams,
  NetworkJackpotsEnsurePeriodRow,
  NetworkJackpotsFindDrawParams,
  NetworkJackpotsFindPendingDrawsParams,
  NetworkJackpotsLockParticipantPeriodParams,
  NetworkJackpotsRevealCardParams,
  NetworkJackpotsTryLockScheduleRow,
} from './network-jackpots.repository.types.js'
import type { Participation, Period } from './network-jackpots.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class NetworkJackpotsRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  clock(transaction?: Transaction): Promise<NetworkJackpotsClockRow[]> {
    return this.db.query<NetworkJackpotsClockRow>('SELECT clock_timestamp() AS now', {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  lockSchedule(transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>('SELECT pg_advisory_xact_lock(70419002)', {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  ensurePeriod(
    params: NetworkJackpotsEnsurePeriodParams,
    transaction?: Transaction,
  ): Promise<NetworkJackpotsEnsurePeriodRow[]> {
    return this.db.query<NetworkJackpotsEnsurePeriodRow>(
      `
        INSERT INTO jackpot_periods(id,pool,starts_at,ends_at)
        VALUES(:id,:pool,:start,:end)
        ON CONFLICT(pool,starts_at)
        DO UPDATE SET pool=EXCLUDED.pool
        RETURNING id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  contributeToPeriod(
    params: NetworkJackpotsContributeToPeriodParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        UPDATE jackpot_periods
        SET amount=amount+CAST(:amount AS BIGINT),total_weight=total_weight+CAST(:stake AS BIGINT)
        WHERE id=:id
          AND status='OPEN'
        RETURNING id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  contributeToParticipant(
    params: NetworkJackpotsContributeToParticipantParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        INSERT INTO jackpot_participants(period_id,user_id,weight)
        VALUES(:period,:user,:stake)
        ON CONFLICT(period_id,user_id)
        DO UPDATE SET weight=jackpot_participants.weight+EXCLUDED.weight
        RETURNING user_id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  setLockTimeout(transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>("SET LOCAL lock_timeout='3s'", {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  setStatementTimeout(transaction?: Transaction): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>("SET LOCAL statement_timeout='5s'", {
      transaction,
      type: QueryTypes.SELECT,
    })
  }

  tryLockSchedule(transaction?: Transaction): Promise<NetworkJackpotsTryLockScheduleRow[]> {
    return this.db.query<NetworkJackpotsTryLockScheduleRow>(
      'SELECT pg_try_advisory_xact_lock(70419002) AS locked',
      { transaction, type: QueryTypes.SELECT },
    )
  }

  findPendingDraws(
    params: NetworkJackpotsFindPendingDrawsParams,
    transaction?: Transaction,
  ): Promise<Participation[]> {
    return this.db.query<Participation>(
      `
        SELECT p.*,j.opened,j.version
        FROM jackpot_participants j
        JOIN jackpot_periods p ON p.id=j.period_id
        WHERE j.user_id=:user
          AND p.status='DRAWN'
          AND (j.opened<>7
          OR (p.winner_id=:user
          AND NOT p.paid))
        ORDER BY p.ends_at,p.id
        LIMIT 21
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  findDraw(
    params: NetworkJackpotsFindDrawParams,
    transaction?: Transaction,
  ): Promise<Participation[]> {
    return this.db.query<Participation>(
      `
        SELECT p.*,j.opened,j.version
        FROM jackpot_participants j
        JOIN jackpot_periods p ON p.id=j.period_id
        WHERE j.user_id=:user
          AND p.id=:id
          AND p.status='DRAWN'
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  lockParticipantPeriod(
    params: NetworkJackpotsLockParticipantPeriodParams,
    transaction?: Transaction,
  ): Promise<Period[]> {
    return this.db.query<Period>(
      `
        SELECT p.*
        FROM jackpot_periods p
        JOIN jackpot_participants j ON j.period_id=p.id
        WHERE p.id=:id
          AND j.user_id=:user
          AND p.status='DRAWN' FOR UPDATE OF p
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  revealCard(
    params: NetworkJackpotsRevealCardParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        UPDATE jackpot_participants
        SET opened=opened | :bit,version=version+1
        WHERE period_id=:id
          AND user_id=:user
        RETURNING version
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }
}
