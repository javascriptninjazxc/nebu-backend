import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

if (existsSync('.env')) {
  loadEnvFile('.env')
}

if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for backend E2E')
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    // Suites share aggregate game counters in one test database.
    fileParallelism: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
})
