import { fileURLToPath } from 'node:url'
import { loadEnvFile } from 'node:process'
import { existsSync } from 'node:fs'

process.chdir(fileURLToPath(new URL('../', import.meta.url)))

if (existsSync('.env')) {
  loadEnvFile('.env')
}

if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('A separate TEST_DATABASE_URL is required')
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.PORT = '3004'
process.env.NODE_ENV = 'test'
await import('./migrate.mjs')
await import('../dist/main.js')
