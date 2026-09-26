import { Controller, Get, Header, Inject } from '@nestjs/common'
import { Sequelize } from 'sequelize-typescript'
import { QueryTypes } from 'sequelize'

@Controller('live-wins')
export class LiveWinsController {
  constructor(@Inject(Sequelize) private readonly db: Sequelize) {}
  @Get('players')
  @Header('Cache-Control', 'public, max-age=30')
  async players() {
    const rows = await this.db.query<{ game: string; players: number }>(
      `SELECT game,COUNT(DISTINCT user_id)::integer AS players FROM (
    SELECT game,user_id FROM original_rounds WHERE created_at>=NOW()-INTERVAL '24 hours'
    UNION ALL SELECT 'dice' AS game,user_id FROM dice_rounds WHERE created_at>=NOW()-INTERVAL '24 hours'
   ) activity GROUP BY game`,
      { type: QueryTypes.SELECT },
    )

    return {
      period: '24h',
      games: Object.fromEntries(
        ['forest', 'caches', 'dice', 'chest'].map((game) => [
          game,
          rows.find((row) => row.game === game)?.players ?? 0,
        ]),
      ),
    }
  }
  @Get()
  @Header('Cache-Control', 'public, max-age=5')
  async get() {
    const rows = await this.db.query<{
      id: string
      player: string
      game: string
      amountMinor: string
      createdAt: string
    }>(
      `SELECT md5(e.id::text) AS id, CASE WHEN length(u.login)>5 THEN left(u.login,2)||'***'||right(u.login,1) ELSE left(u.login,1)||'***' END AS player,
   COALESCE(r.game,'dice') AS game,e.delta::text AS "amountMinor",e.created_at AS "createdAt"
   FROM dice_entries e JOIN users u ON u.id=e.user_id LEFT JOIN original_rounds r ON r.id=e.game_round_id LEFT JOIN dice_rounds d ON d.id=e.round_id
   WHERE e.reason='PAYOUT' AND e.delta>0 AND ((r.id IS NOT NULL AND NOT r.active AND r.payout>r.stake AND COALESCE(r.state->>'freePush','false')!='true') OR (d.id IS NOT NULL AND d.status!='ACTIVE' AND d.payout>d.stake))
   ORDER BY e.created_at DESC,e.id DESC LIMIT 20`,
      { type: QueryTypes.SELECT },
    )

    return { wins: rows }
  }
}
