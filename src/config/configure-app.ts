import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { ApiExceptionFilter } from '../common/http/api-exception.filter.js'
import { requestContext } from '../common/http/request-context.js'
import type { Environment } from './environment.js'

export function configureApp(app: NestExpressApplication, env: Environment): void {
  app.use(requestContext)
  app.use(
    helmet({
      strictTransportSecurity: env.nodeEnv === 'production' ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: env.nodeEnv === 'production' ? [] : null,
        },
      },
    }),
  )
  app.setGlobalPrefix('api')
  app.disable('x-powered-by')
  app.useBodyParser('json', { limit: '100kb' })
  app.enableCors({
    origin: env.corsOrigins,
    credentials: false,
    exposedHeaders: ['x-request-id'],
  })
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }),
  )
  app.useGlobalFilters(new ApiExceptionFilter())
  app.enableShutdownHooks()

  if (env.swaggerEnabled) {
    const options = new DocumentBuilder()
      .setTitle('Nebuli API')
      .setDescription('Nebuli backend API')
      .setVersion('1.0')
      .build()

    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, options), {
      jsonDocumentUrl: 'api/docs-json',
    })
  }
}
