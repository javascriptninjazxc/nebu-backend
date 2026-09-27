import { ConsoleLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import 'reflect-metadata'
import { AppModule } from './app.module.js'
import { configureApp } from './config/configure-app.js'
import { readEnvironment } from './config/environment.js'

if (existsSync('.env')) {
  loadEnvFile('.env')
}

const env = readEnvironment()

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: new ConsoleLogger({ json: true }),
})

configureApp(app, env)
await app.listen(env.port, env.host)
