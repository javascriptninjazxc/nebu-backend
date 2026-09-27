import { Body, Controller, Get, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { IsInt, Min } from 'class-validator'
import request from 'supertest'
import { configureApp } from '../src/config/configure-app.js'
import { readEnvironment } from '../src/config/environment.js'

class SampleDto {
  @IsInt()
  @Min(1)
  amount!: number
}

@Controller('probe')
class ProbeController {
  @Post()
  accept(@Body() body: SampleDto) {
    return body
  }

  @Get('failure')
  fail() {
    throw new Error('private database credentials')
  }
}
// Vitest transpiles without TypeScript's emitted decorator metadata.
Reflect.defineMetadata('design:paramtypes', [SampleDto], ProbeController.prototype, 'accept')

describe('HTTP platform', () => {
  let app: NestExpressApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile()

    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
    })
    configureApp(app, readEnvironment({ NODE_ENV: 'test' }))
    await app.init()
  })
  afterAll(async () => {
    await app.close()
  })
  it('validates DTOs and rejects extra fields and coerced numbers', async () => {
    await request(app.getHttpServer())
      .post('/api/probe')
      .send({ amount: 10 })
      .expect(201)
      .expect({ amount: 10 })

    for (const body of [{ amount: 0 }, { amount: '10' }, { amount: 10, admin: true }]) {
      const result = await request(app.getHttpServer()).post('/api/probe').send(body).expect(400)

      expect(result.body.message).toBeInstanceOf(Array)
      expect(result.body.requestId).toEqual(expect.any(String))
    }
  })
  it('propagates safe request IDs and sets security headers', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/missing')
      .set('x-request-id', 'test-123')
      .expect(404)

    expect(result.headers['x-request-id']).toBe('test-123')
    expect(result.headers['x-content-type-options']).toBe('nosniff')
    expect(result.body).toMatchObject({
      statusCode: 404,
      requestId: 'test-123',
    })

    const invalid = await request(app.getHttpServer())
      .get('/api/missing')
      .set('x-request-id', 'invalid id')

    expect(invalid.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/)
  })
  it('hides internal exception details', async () => {
    const result = await request(app.getHttpServer()).get('/api/probe/failure').expect(500)

    expect(result.body.message).toBe('Internal server error')
    expect(JSON.stringify(result.body)).not.toContain('credentials')
  })
  it('normalizes parser errors and rejects oversized payloads', async () => {
    await request(app.getHttpServer())
      .post('/api/probe')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400)
    await request(app.getHttpServer())
      .post('/api/probe')
      .send({ amount: 'x'.repeat(110000) })
      .expect(413)
  })
  it('does not expose docs when disabled', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(404)
    await request(app.getHttpServer()).get('/api/docs-json').expect(404)
  })
})
