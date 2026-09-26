import 'reflect-metadata'
import { loadEnvFile } from 'node:process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { NestFactory } from '@nestjs/core'
import { io } from 'socket.io-client'

process.chdir(fileURLToPath(new URL('../', import.meta.url)))

if (existsSync('.env')) {
  loadEnvFile('.env')
}

if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('Separate test DB required')
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.NODE_ENV = 'test'
process.env.DICE_WS_HANDSHAKES_PER_MIN = '1000'
process.env.DICE_WS_ORIGINS = 'http://127.0.0.1:3100'
await import('./migrate.mjs')

const { AppModule } = await import('../dist/app.module.js')

const { AuthService } = await import('../dist/auth/auth.service.js')

const { DiceService } = await import('../dist/dice/dice.service.js')

const { Sequelize } = await import('sequelize-typescript')

const app = await NestFactory.create(AppModule, { logger: false })

const clients = []

try {
  await app.listen(0, '127.0.0.1')

  const url = 'http://127.0.0.1:' + app.getHttpServer().address().port

  const auth = app.get(AuthService)

  const dice = app.get(DiceService)

  for (let batch = 0; batch < 20; batch++) {
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const account = await auth.quick()

        const { ticket } = await dice.ticket(account.token)

        const s = io(url + '/dice', {
          transports: ['websocket'],
          reconnection: false,
          auth: { ticket },
          extraHeaders: { Origin: 'http://127.0.0.1:3100' },
        })

        clients.push({ s, id: account.user.id, round: null })
        await new Promise((resolve, reject) => {
          s.once('connect', resolve)
          s.once('connect_error', reject)
        })
      }),
    )
  }

  const latencies = []

  const errors = []

  const started = performance.now()

  const jobs = []

  for (let index = 0; index < 300; index++) {
    const wait = started + index * 20 - performance.now()

    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }

    const c = clients[index % 100]

    const stage = Math.floor(index / 100)

    let event = 'dice.start'

    let body = { stakeMinor: '10000', mines: 3 }

    if (stage === 1) {
      event = 'dice.reveal'
      body = { roundId: c.round.roundId, expectedVersion: c.round.version, cellIndex: 4 }
    }

    if (stage === 2) {
      event = c.round.status === 'ACTIVE' ? 'dice.cashout' : 'dice.sync'
      body =
        event === 'dice.cashout'
          ? { roundId: c.round.roundId, expectedVersion: c.round.version }
          : {}
    }

    const before = performance.now()

    jobs.push(
      c.s
        .timeout(8000)
        .emitWithAck(event, { requestId: randomUUID(), ...body })
        .then((reply) => {
          latencies.push(performance.now() - before)

          if (!reply.ok) {
            errors.push(reply.error.code)
          } else {
            c.round = reply.data.round
          }
        })
        .catch(() => errors.push('TRANSPORT')),
    )
  }

  await Promise.all(jobs)
  latencies.sort((a, b) => a - b)

  const db = app.get(Sequelize)

  const [bad] = await db.query(
    'SELECT w.user_id FROM dice_wallets w JOIN (SELECT user_id,SUM(delta) AS total FROM dice_entries GROUP BY user_id) e ON e.user_id=w.user_id WHERE w.balance<>e.total',
  )

  const report = {
    date: new Date().toISOString(),
    environment:
      'Windows localhost; real Nest + Socket.IO + PostgreSQL; pool 10; 100 preconnected accounts',
    connections: 100,
    commands: 300,
    targetCommandsPerSecond: 50,
    elapsedMs: Math.round(performance.now() - started),
    p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
    p95Ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
    p99Ms: Math.round(latencies[Math.floor(latencies.length * 0.99)]),
    errors,
    ledgerMismatches: bad.length,
  }

  writeFileSync('dice-load-result.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))

  if (errors.length || bad.length || report.p95Ms > 250) {
    process.exitCode = 1
  }
} finally {
  clients.forEach((c) => c.s.disconnect())
  await app.close()
}
