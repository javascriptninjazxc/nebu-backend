import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/config/configure-app.js'
import { readEnvironment } from '../src/config/environment.js'

describe('backend HTTP', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = module.createNestApplication<NestExpressApplication>()
    configureApp(app, readEnvironment({}))
    await app.init()
  })
  afterAll(async () => {
    await app.close()
  })
  it('serves health under /api', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', service: 'nebuli-backend' })
    await request(app.getHttpServer()).get('/health').expect(404)
  })
  it('exposes schedules without inventing balances or payouts', async () => {
    const response = await request(app.getHttpServer()).get('/api/jackpots/config').expect(200)

    expect(response.body).toMatchObject({
      enabled: true,
      currency: 'DEMO',
      eligibleGame: 'caches',
      pools: [
        {
          id: 'mini',
          contributionBasisPoints: 100,
          schedule: { period: 'hour' },
        },
        {
          id: 'mega',
          contributionBasisPoints: 100,
          schedule: { period: 'day', hour: 0 },
        },
      ],
    })
    await request(app.getHttpServer())
      .post('/api/jackpots/claim')
      .send({ amount: 7000 })
      .expect(404)
  })
  it('only returns CORS permission for configured origins', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:3000')

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(allowed.headers['x-powered-by']).toBeUndefined()

    const denied = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'https://unexpected.example')

    expect(denied.headers['access-control-allow-origin']).toBeUndefined()
  })
})
