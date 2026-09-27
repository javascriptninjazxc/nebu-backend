import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { Op, Transaction, literal } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import { DiceEntry, DiceWallet } from '../dice/models.js'
import { AuthService } from './auth.service.js'
import { AuthSession, User } from './models.js'
import { PlayerProfilesModel } from './player-profiles.model.js'
import { avatars, defaultAvatar } from './profile.constants.js'
import type { PlayerProfile } from './profile.contracts.js'
import { ProfileRepository } from './profile.repository.js'

@Injectable()
export class ProfileService {
  constructor(
    @Inject(Sequelize) private readonly db: Sequelize,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ProfileRepository) private readonly repository: ProfileRepository,
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
        const account = await User.findByPk(user.id, {
          attributes: ['createdAt'],
          transaction,
          rejectOnEmpty: true,
        })
        const profile = await PlayerProfilesModel.findByPk(user.id, { transaction })
        const wallet = await DiceWallet.findByPk(user.id, { transaction })
        const { stats, history } = await this.repository.history(
          { user: user.id, days, game, offset: page * 20 },
          transaction,
        )
        const ledger = await DiceEntry.findAndCountAll({
          where: { userId: user.id },
          order: [
            ['createdAt', 'DESC'],
            ['id', 'DESC'],
          ],
          limit: 20,
          offset: ledgerPage * 20,
          transaction,
        })
        const sessions = await AuthSession.count({
          where: { userId: user.id, expiresAt: { [Op.gt]: literal('NOW()') } },
          transaction,
        })

        return {
          user: {
            ...user,
            displayName: profile?.display_name ?? user.login,
            avatar: profile?.avatar ?? defaultAvatar,
            createdAt: account.createdAt.toISOString(),
          },
          balanceMinor: wallet?.balance ?? '0',
          stats,
          history,
          historyTotal: stats.rounds,
          entries: ledger.rows.map((entry) => ({
            id: entry.id,
            reason: entry.reason,
            deltaMinor: String(entry.delta),
            balanceAfterMinor: String(entry.balanceAfter),
            createdAt: entry.createdAt.toISOString(),
          })),
          entriesTotal: ledger.count,
          sessions,
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

    await PlayerProfilesModel.upsert({
      user_id: user.id,
      display_name: displayName.trim(),
      avatar,
      updated_at: new Date(),
    })

    return { ok: true }
  }
}
