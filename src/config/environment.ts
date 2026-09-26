export interface Environment {
  nodeEnv: 'development' | 'test' | 'production'
  swaggerEnabled: boolean
  port: number
  host: string
  corsOrigins: string[]
}

export function readEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const nodeEnv = env.NODE_ENV ?? 'development'

  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test or production')
  }

  if (env.SWAGGER_ENABLED !== undefined && !['true', 'false'].includes(env.SWAGGER_ENABLED)) {
    throw new Error('SWAGGER_ENABLED must be true or false')
  }

  const swaggerEnabled =
    env.SWAGGER_ENABLED === undefined ? nodeEnv === 'development' : env.SWAGGER_ENABLED === 'true'

  const rawPort = env.PORT ?? '3001'

  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  const host = env.HOST?.trim() ?? '127.0.0.1'

  if (!host) {
    throw new Error('HOST must not be empty')
  }

  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  for (const origin of corsOrigins) {
    let url: URL

    try {
      url = new URL(origin)
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP origins')
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain origins without paths, credentials or wildcards')
    }
  }

  return { nodeEnv, swaggerEnabled, port: Number(rawPort), host, corsOrigins }
}
