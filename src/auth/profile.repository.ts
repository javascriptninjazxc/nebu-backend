import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, type Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type { PlayerProfile, ProfileRound } from './profile.contracts.js'
import type { ProfileHistoryFilter } from './profile.types.js'

// A UNION keeps pagination and exact BIGINT aggregates global across both round tables.
const roundsSql = `
        SELECT id,game,stake,payout,created_at
        FROM original_rounds
        WHERE user_id=:user
          AND NOT active
          AND COALESCE(state->>'freePush','false')!='true'
        UNION ALL SELECT id,'dice' AS game,stake,payout,created_at
        FROM dice_rounds
        WHERE user_id=:user
          AND status!='ACTIVE'
      `

@Injectable()
export class ProfileRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  async history(filter: ProfileHistoryFilter, transaction: Transaction) {
    const where = `
        WHERE (:days IS NULL
          OR created_at >= NOW() - CAST(:days AS integer) * INTERVAL '1 day')
          AND (:game = 'all'
          OR game=:game)
      `
    const options = { replacements: { ...filter }, transaction, type: QueryTypes.SELECT as const }
    const [stats] = await this.db.query<PlayerProfile['stats']>(
      `WITH rounds AS (${roundsSql}) SELECT COUNT(*)::integer AS rounds,COALESCE(SUM(stake),0)::text AS "stakeMinor",COALESCE(SUM(payout),0)::text AS "payoutMinor" FROM rounds ${where}`,
      options,
    )
    const history = await this.db.query<ProfileRound>(
      `WITH rounds AS (${roundsSql}) SELECT id,game,stake::text AS "stakeMinor",payout::text AS "payoutMinor",created_at AS "createdAt" FROM rounds ${where} ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET :offset`,
      options,
    )
    return { stats, history }
  }
}
