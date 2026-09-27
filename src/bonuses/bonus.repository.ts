import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type {
  BonusApplyCappedTurnoverParams,
  BonusApplyTurnoverParams,
  BonusClaimTurnoverParams,
  BonusCreateGrantParams,
  BonusCreditBonusBetParams,
  BonusCreditBonusRoundParams,
  BonusCreditGrantAndRequirementParams,
  BonusCreditGrantBalanceParams,
  BonusCreditWalletParams,
  BonusCreditWalletRow,
  BonusDebitGrantParams,
  BonusLockAccountParams,
  BonusLockGuestParams,
  BonusLockReleasableGrantsParams,
  BonusWeeklyDepositsParams,
  BonusWeeklyDepositsRow,
  BonusWeekWindowRow,
} from './bonus.repository.types.js'
import type { Grant } from './bonus.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class BonusRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  lockAccount(
    params: BonusLockAccountParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'SELECT pg_advisory_xact_lock(hashtextextended(:user,70419))',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  lockGuest(
    params: BonusLockGuestParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'SELECT pg_advisory_xact_lock(hashtextextended(:guest,70420))',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  weekWindow(transaction?: Transaction): Promise<BonusWeekWindowRow[]> {
    return this.db.query<BonusWeekWindowRow>(
      `
        SELECT to_char(date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow'),'YYYY-MM-DD') AS period, (date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 week') AT TIME ZONE 'Europe/Moscow' AS next
      `,
      { transaction, type: QueryTypes.SELECT },
    )
  }

  weeklyDeposits(
    params: BonusWeeklyDepositsParams,
    transaction?: Transaction,
  ): Promise<BonusWeeklyDepositsRow[]> {
    return this.db.query<BonusWeeklyDepositsRow>(
      `
        SELECT COALESCE(SUM(amount_minor),0)::TEXT total
        FROM confirmed_deposits
        WHERE user_id=:user
          AND reversed_at IS NULL
          AND confirmed_at>=date_trunc('week',NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'
          AND confirmed_at<=NOW()
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  createGrant(
    params: BonusCreateGrantParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        INSERT INTO bonus_grants(id,user_id,game,stake,remaining,expires_at,wager_multiplier)
        VALUES(:id,:user,:game,:stake,:rounds,NOW() + CAST(:days AS INTEGER) * INTERVAL '1 day',:multiplier)
        RETURNING id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  debitGrant(
    params: BonusDebitGrantParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_grants SET balance=balance-CAST(:stake AS BIGINT) WHERE id=:id RETURNING id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditBonusBet(
    params: BonusCreditBonusBetParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_bets SET won_minor=won_minor+CAST(:amount AS BIGINT) WHERE round_id=:round RETURNING round_id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditGrantBalance(
    params: BonusCreditGrantBalanceParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_grants SET balance=balance+CAST(:amount AS BIGINT) WHERE id=:id RETURNING id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditBonusRound(
    params: BonusCreditBonusRoundParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_rounds SET won_minor=won_minor+CAST(:amount AS BIGINT) WHERE round_id=:round RETURNING round_id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditGrantAndRequirement(
    params: BonusCreditGrantAndRequirementParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        UPDATE bonus_grants
        SET balance=balance+CAST(:amount AS BIGINT),winnings=winnings+CAST(:amount AS BIGINT),required=CEIL((winnings+CAST(:amount AS BIGINT))*wager_multiplier)
        WHERE id=:id
        RETURNING id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  applyCappedTurnover(
    params: BonusApplyCappedTurnoverParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_grants SET wagered=LEAST(required,wagered+CAST(:stake AS BIGINT)) WHERE id=:id RETURNING id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  claimTurnover(
    params: BonusClaimTurnoverParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      `
        INSERT INTO bonus_turnover(round_id,user_id,stake)
        VALUES(:round,:user,:stake)
        ON CONFLICT DO NOTHING
        RETURNING round_id
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  applyTurnover(
    params: BonusApplyTurnoverParams,
    transaction?: Transaction,
  ): Promise<Record<string, unknown>[]> {
    return this.db.query<Record<string, unknown>>(
      'UPDATE bonus_grants SET wagered=wagered+CAST(:add AS BIGINT) WHERE id=:id RETURNING id',
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  lockReleasableGrants(
    params: BonusLockReleasableGrantsParams,
    transaction?: Transaction,
  ): Promise<Grant[]> {
    return this.db.query<Grant>(
      `
        SELECT *
        FROM bonus_grants g
        WHERE user_id=:user
          AND NOT released
          AND required<=wagered
          AND (remaining=0
          OR expires_at<=NOW())
          AND NOT EXISTS(SELECT 1
        FROM bonus_rounds r
        WHERE r.grant_id=g.id
          AND NOT settled)
          AND NOT EXISTS(SELECT 1
        FROM bonus_bets b
        WHERE b.grant_id=g.id
          AND NOT b.settled) FOR UPDATE
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }

  creditWallet(
    params: BonusCreditWalletParams,
    transaction?: Transaction,
  ): Promise<BonusCreditWalletRow[]> {
    return this.db.query<BonusCreditWalletRow>(
      `
        UPDATE dice_wallets
        SET balance=balance+CAST(:amount AS BIGINT),version=version+1
        WHERE user_id=:user
        RETURNING balance
      `,
      { replacements: { ...params }, transaction, type: QueryTypes.SELECT },
    )
  }
}
