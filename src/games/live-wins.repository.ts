import { Inject, Injectable } from '@nestjs/common'
import { QueryTypes, type Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import type {
  LiveWinsActivePlayersRow,
  LiveWinsRecentWinsRow,
} from './live-wins.repository.types.js'

// PostgreSQL-specific operations: atomic conditional arithmetic, locks and cross-table projections.
// Keep all values parameterized and retain the caller's transaction.
@Injectable()
export class LiveWinsRepository {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}

  activePlayers(transaction?: Transaction): Promise<LiveWinsActivePlayersRow[]> {
    return this.db.query<LiveWinsActivePlayersRow>(
      `
        SELECT game,COUNT(DISTINCT user_id)::integer AS players
        FROM ( SELECT game,user_id
        FROM original_rounds
        WHERE created_at>=NOW()-INTERVAL '24 hours'
        UNION ALL SELECT 'dice' AS game,user_id
        FROM dice_rounds
        WHERE created_at>=NOW()-INTERVAL '24 hours' ) activity
        GROUP BY game
      `,
      { transaction, type: QueryTypes.SELECT },
    )
  }

  recentWins(transaction?: Transaction): Promise<LiveWinsRecentWinsRow[]> {
    return this.db.query<LiveWinsRecentWinsRow>(
      `
        SELECT md5(e.id::text) AS id, CASE WHEN length(u.login)>5 THEN left(u.login,2)||'***'||right(u.login,1) ELSE left(u.login,1)||'***' END AS player, COALESCE(r.game,'dice') AS game,e.delta::text AS "amountMinor",e.created_at AS "createdAt"
        FROM dice_entries e
        JOIN users u ON u.id=e.user_id
        LEFT JOIN original_rounds r ON r.id=e.game_round_id
        LEFT JOIN dice_rounds d ON d.id=e.round_id
        WHERE e.reason='PAYOUT'
          AND e.delta>0
          AND ((r.id IS NOT NULL
          AND NOT r.active
          AND r.payout>r.stake
          AND COALESCE(r.state->>'freePush','false')!='true')
          OR (d.id IS NOT NULL
          AND d.status!='ACTIVE'
          AND d.payout>d.stake))
        ORDER BY e.created_at DESC,e.id DESC
        LIMIT 20
      `,
      { transaction, type: QueryTypes.SELECT },
    )
  }
}
