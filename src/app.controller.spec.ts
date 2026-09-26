import { AppService } from './app.service.js'
import { readEnvironment } from './config/environment.js'

describe('backend configuration', () => {
  it('uses a separate localhost port', () => {
    expect(readEnvironment({})).toEqual({
      nodeEnv: 'development',
      swaggerEnabled: true,
      port: 3001,
      host: '127.0.0.1',
      corsOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    })
  })
  it.each(['0', '65536', '3001x', '1.2', ''])('rejects invalid port %s', (port) => {
    expect(() => readEnvironment({ PORT: port })).toThrow('PORT')
  })
  it.each(['*', 'https://example.com/path', 'https://user:secret@example.com', 'file:///tmp'])(
    'rejects invalid origin %s',
    (origin) => {
      expect(() => readEnvironment({ CORS_ORIGINS: origin })).toThrow('CORS_ORIGINS')
    },
  )
  it('allows explicit origins and trims whitespace', () => {
    expect(
      readEnvironment({ PORT: '4100', CORS_ORIGINS: ' https://example.com ' }).corsOrigins,
    ).toEqual(['https://example.com'])
  })
  it('returns liveness without claiming a database is connected', () => {
    expect(new AppService().getHealth()).toEqual({
      status: 'ok',
      service: 'nebuli-backend',
    })
  })
})

describe('environment modes', () => {
  it('disables Swagger in production by default', () => {
    expect(readEnvironment({ NODE_ENV: 'production' }).swaggerEnabled).toBe(false)
  })
  it('accepts explicit Swagger override', () => {
    expect(readEnvironment({ SWAGGER_ENABLED: 'false' }).swaggerEnabled).toBe(false)
  })
  it('rejects invalid mode and boolean configuration', () => {
    expect(() => readEnvironment({ NODE_ENV: 'prod' })).toThrow('NODE_ENV')
    expect(() => readEnvironment({ SWAGGER_ENABLED: 'yes' })).toThrow('SWAGGER_ENABLED')
  })
})
