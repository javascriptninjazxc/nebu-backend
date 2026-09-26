import { BonusService, guestDigest } from '../bonuses/bonus.service.js'
import { HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectModel } from '@nestjs/sequelize'
import { Sequelize } from 'sequelize-typescript'
import { Op, QueryTypes, type Transaction } from 'sequelize'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { User, AuthSession } from './models.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })

@Injectable()
export class AuthService {
  constructor(
    @Inject(BonusService) private readonly bonuses: BonusService,
    @InjectModel(User) private readonly users: typeof User,
    @InjectModel(AuthSession) private readonly sessions: typeof AuthSession,
    @Inject(Sequelize) private readonly db: Sequelize,
  ) {}
  async limit(key: string, maximum: number) {
    await this.db.query("DELETE FROM auth_limits WHERE expires_at < NOW() - INTERVAL '1 day'")

    const rows = await this.db.query<{ count: number }>(
      `INSERT INTO auth_limits (key, count, expires_at) VALUES (:key, 1, NOW() + INTERVAL '1 minute')
   ON CONFLICT (key) DO UPDATE SET count = CASE WHEN auth_limits.expires_at <= NOW() THEN 1 ELSE auth_limits.count + 1 END,
   expires_at = CASE WHEN auth_limits.expires_at <= NOW() THEN NOW() + INTERVAL '1 minute' ELSE auth_limits.expires_at END RETURNING count`,
      { replacements: { key: digest(key) }, type: QueryTypes.SELECT },
    )

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
