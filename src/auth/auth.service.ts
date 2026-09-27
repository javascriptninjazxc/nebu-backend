import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { literal, Op, type Transaction } from 'sequelize'
import { Sequelize } from 'sequelize-typescript'
import { BonusService } from '../bonuses/bonus.service.js'
import { guestDigest } from '../bonuses/bonus.utils.js'
import { AuthLimitsModel } from './auth-limits.model.js'
import { AuthRepository } from './auth.repository.js'
import { AuthSession, User } from './models.js'
import { derive, digest } from './password.utils.js'

@Injectable()
export class AuthService {
  constructor(
    @Inject(AuthRepository) private readonly repository: AuthRepository,
    @Inject(BonusService) private readonly bonuses: BonusService,
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(AuthSession) private readonly sessions: typeof AuthSession,
    @Inject(Sequelize) private readonly db: Sequelize,
  ) {}

  async limit(key: string, maximum: number) {
    await AuthLimitsModel.destroy({
      where: { expires_at: { [Op.lt]: literal("NOW() - INTERVAL '1 day'") } },
    })

    const rows = await this.repository.incrementLoginLimit({ key: digest(key) })

    if (rows[0].count > maximum) {
      throw new HttpException('Слишком много попыток. Попробуй через минуту.', 429)
    }
  }

  async quick(promo?: string, guest?: string) {
    const user = {
      id: randomUUID(),
      login: 'nebi_' + randomBytes(8).toString('hex'),
    }

    const password = randomBytes(18).toString('base64url')

    const salt = randomBytes(16).toString('hex')

    const passwordHash = (await derive(password, salt)).toString('hex')

    return this.db.transaction(async (transaction) => {
      await this.users.create(
        {
          ...user,
          salt,
          passwordHash,
          promo: promo || null,
          createdAt: new Date(),
        },
        { transaction },
      )

      if (guest && /^[A-Za-z0-9_-]{43}$/.test(guest)) {
        await this.bonuses.bindGuest(user.id, guestDigest(guest), transaction)
      }

      return {
        ...(await this.session(user, transaction)),
        credentials: { login: user.login, password },
      }
    })
  }

  async login(login: string, password: string) {
    await this.limit('login:' + login, 10)

    const row = await this.users.findOne({ where: { login } })

    const key = await derive(password, row?.salt ?? '00000000000000000000000000000000')

    const expected = row ? Buffer.from(row.passwordHash, 'hex') : Buffer.alloc(64)

    if (!timingSafeEqual(key, expected) || !row) {
      throw new UnauthorizedException('Неверный логин или пароль')
    }

    return this.session({ id: row.id, login: row.login })
  }

  private async session(user: { id: string; login: string }, transaction?: Transaction) {
    const token = randomBytes(32).toString('base64url')

    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000

    await this.sessions.destroy({
      where: { expiresAt: { [Op.lte]: new Date() } },
      transaction,
    })
    await this.sessions.create(
      { hash: digest(token), userId: user.id, expiresAt: new Date(expiresAt) },
      { transaction },
    )

    return { user, token, expiresAt }
  }

  async me(token: string) {
    const session = await this.sessions.findOne({
      where: { hash: digest(token), expiresAt: { [Op.gt]: new Date() } },
    })

    const user = session ? await this.users.findByPk(session.userId) : null

    if (!user) {
      throw new UnauthorizedException('Сессия завершена. Войди снова.')
    }

    return { user: { id: user.id, login: user.login } }
  }

  async changePassword(token: string, currentPassword: string, newPassword: string) {
    const { user } = await this.me(token)

    await this.limit('password:' + user.id, 5)

    return this.db.transaction(async (transaction) => {
      const row = await this.users.findByPk(user.id, { transaction, lock: transaction.LOCK.UPDATE })

      if (
        !row ||
        !timingSafeEqual(
          await derive(currentPassword, row.salt),
          Buffer.from(row.passwordHash, 'hex'),
        )
      ) {
        throw new UnauthorizedException('Неверный текущий пароль.')
      }

      const salt = randomBytes(16).toString('hex')

      await row.update(
        { salt, passwordHash: (await derive(newPassword, salt)).toString('hex') },
        { transaction },
      )
      await this.sessions.destroy({
        where: { userId: user.id, hash: { [Op.ne]: digest(token) } },
        transaction,
      })

      return { ok: true }
    })
  }

  async revokeOtherSessions(token: string) {
    const { user } = await this.me(token)

    await this.limit('sessions:' + user.id, 10)
    await this.sessions.destroy({ where: { userId: user.id, hash: { [Op.ne]: digest(token) } } })

    return { ok: true }
  }

  async logout(token: string) {
    await this.sessions.destroy({ where: { hash: digest(token) } })
  }
}
