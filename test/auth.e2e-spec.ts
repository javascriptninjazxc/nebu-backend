import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { Sequelize } from 'sequelize-typescript'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { AuthController } from '../src/auth/auth.controller.js'
import { LoginDto, QuickDto } from '../src/auth/auth.dto.js'
import { AuthSession, User } from '../src/auth/models.js'
import { configureApp } from '../src/config/configure-app.js'
import { readEnvironment } from '../src/config/environment.js'

Reflect.defineMetadata('design:paramtypes', [LoginDto, Object], AuthController.prototype, 'login')
Reflect.defineMetadata('design:paramtypes', [QuickDto, Object], AuthController.prototype, 'quick')
describe('PostgreSQL authentication', () => {
  let app: NestExpressApplication

  let db: Sequelize

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    })
    configureApp(app, readEnvironment({ NODE_ENV: 'test' }))
    await app.init()
    db = app.get(Sequelize)
    await db.query('DELETE FROM auth_limits')
  })
  afterAll(async () => {
    await app?.close()
  })
  it('creates credentials, hashes secrets, normalizes login, revokes sessions and rejects expired sessions', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/auth/quick')
      .send({ promo: 'TEST' })
      .expect(201)

    const { credentials, token, user } = created.body

    expect(credentials.login).toMatch(/^nebi_[a-f0-9]{16}$/)
    expect(credentials.password.length).toBeGreaterThanOrEqual(24)
    expect(created.headers['cache-control']).toBe('no-store')

    const row = await User.findByPk(user.id)

    expect(row?.passwordHash).not.toBe(credentials.password)
    expect(row?.passwordHash).toHaveLength(128)
    expect(await AuthSession.findByPk(token)).toBeNull()
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(200)
      .expect({ user })

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        login: ' ' + credentials.login.toUpperCase() + ' ',
        password: credentials.password,
      })
      .expect(200)

    expect(login.body.credentials).toBeUndefined()
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ ...credentials, password: 'wrong' })
      .expect(401)
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer ' + token)
      .expect(204)
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + token)
      .expect(401)
    await AuthSession.update({ expiresAt: new Date(0) }, { where: { userId: user.id } })
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + login.body.token)
      .expect(401)
    await User.destroy({ where: { id: user.id } })
  })
  it('rejects invalid DTOs and rate limits repeated failures', async () => {
    await request(app.getHttpServer()).post('/api/auth/quick').send({ admin: true }).expect(400)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ login: 123, password: 'x' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ login: 'a@b.com', password: 'x' })
      .expect(400)

    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ login: 'missing_test', password: 'wrong' })
        .expect(401)
    }

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ login: 'missing_test', password: 'wrong' })
      .expect(429)
  })
})
