import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { Sequelize } from 'sequelize-typescript'
import { QueryTypes, Transaction } from 'sequelize'
import { AuthService } from './auth.service.js'
import type { PlayerProfile, ProfileRound, ProfileEntry } from './profile.contracts.js'

const defaultAvatar = '/brand/games/greedy-chest/nebi-calm-v1.webp'

const avatars = [
  defaultAvatar,
  '/brand/nebi-awake-v3.webp',
  '/brand/games/greedy-chest/nebi-curious-v1.webp',
]

const roundsSql = `SELECT id,game,stake,payout,created_at FROM original_rounds WHERE user_id=:user AND NOT active AND COALESCE(state->>'freePush','false')!='true'
 UNION ALL SELECT id,'dice' AS game,stake,payout,created_at FROM dice_rounds WHERE user_id=:user AND status!='ACTIVE'`

@Injectable()
export class ProfileService {
  constructor(
    @Inject(Sequelize) private readonly db: Sequelize,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async get(
    token: string,
    period: string,
    game: string,
    page: number,
    ledgerPage: number,
  ): Promise<PlayerProfile> {
    const { user } = await this.auth.me(token)

    await this.auth.limit('profile-read:' + user.id, 120)

    const days = period === 'all' ? null : Number(period)

    if (
      !['7', '30', 'all'].includes(period) ||
      !['all', 'dice', 'forest', 'caches', 'chest'].includes(game) ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 100000 ||
      !Number.isInteger(ledgerPage) ||
      ledgerPage < 0 ||
      ledgerPage > 100000
    ) {
      throw new BadRequestException('Неверный фильтр.')
    }

    return this.db.transaction(
      { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
      async (transaction) => {
        const replacements = {
          user: user.id,
          days,
          game,
          offset: page * 20,
          ledgerOffset: ledgerPage * 20,
        }

        const query = <T extends object>(sql: string) =>
          this.db.query<T>(sql, {
            replacements,
            type: QueryTypes.SELECT,
            transaction,
          })

        const [account] = await query<{
          displayName: string | null
          avatar: string | null
          createdAt: string
        }>(
          `SELECT p.display_name AS "displayName",p.avatar,u."createdAt" FROM users u LEFT JOIN player_profiles p ON p.user_id=u.id WHERE u.id=:user`,
        )

        const [wallet] = await query<{ balance: string }>(
          'SELECT balance::text FROM dice_wallets WHERE user_id=:user',
        )

        const where = `WHERE (:days IS NULL OR created_at >= NOW() - CAST(:days AS integer) * INTERVAL '1 day') AND (:game = 'all' OR game=:game)`

        const [stats] = await query<{
          rounds: number
          stakeMinor: string
          payoutMinor: string
        }>(
          `WITH rounds AS (${roundsSql}) SELECT COUNT(*)::integer AS rounds,COALESCE(SUM(stake),0)::text AS "stakeMinor",COALESCE(SUM(payout),0)::text AS "payoutMinor" FROM rounds ${where}`,
        )

        const history = await query<ProfileRound>(
          `WITH rounds AS (${roundsSql}) SELECT id,game,stake::text AS "stakeMinor",payout::text AS "payoutMinor",created_at AS "createdAt" FROM rounds ${where} ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET :offset`,
        )

        const entries = await query<ProfileEntry>(
          `SELECT id,reason,delta::text AS "deltaMinor",balance_after::text AS "balanceAfterMinor",created_at AS "createdAt" FROM dice_entries WHERE user_id=:user ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET :ledgerOffset`,
        )

        const [entryCount] = await query<{ count: number }>(
          'SELECT COUNT(*)::integer AS count FROM dice_entries WHERE user_id=:user',
        )

        const [sessionCount] = await query<{ count: number }>(
          'SELECT COUNT(*)::integer AS count FROM auth_sessions WHERE "userId"=:user AND "expiresAt">NOW()',
        )

        return {
          user: {
            ...user,
            displayName: account.displayName ?? user.login,
            avatar: account.avatar ?? defaultAvatar,
            createdAt: account.createdAt,
          },
          balanceMinor: wallet?.balance ?? '0',
          stats,
          history,
          historyTotal: stats.rounds,
          entries,
          entriesTotal: entryCount.count,
          sessions: sessionCount.count,
          telegramLinked: false,
        }
      },
    )
  }

  async save(token: string, displayName: string, avatar: string) {
    const { user } = await this.auth.me(token)

    await this.auth.limit('profile-write:' + user.id, 15)

    if (
      !displayName.trim() ||
      displayName.trim().length > 32 ||
      [...displayName].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new BadRequestException('Имя должно содержать от 1 до 32 символов.')
    }

    if (!avatars.includes(avatar)) {
      if (avatar.length > 120000 || !/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/u.test(avatar)) {
        throw new BadRequestException('Выбери изображение из коллекции или загрузи WebP.')
      }

      const bytes = Buffer.from(avatar.split(',')[1], 'base64')

      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
        throw new BadRequestException('Неверный формат аватара.')
      }
    }

    await this.db.query(
      `INSERT INTO player_profiles(user_id,display_name,avatar) VALUES(:user,:name,:avatar) ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar=EXCLUDED.avatar,updated_at=NOW()`,
      { replacements: { user: user.id, name: displayName.trim(), avatar } },
    )

    return { ok: true }
  }
}
