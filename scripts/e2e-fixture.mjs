// Test-process fixture only. Not imported by the application and has no HTTP endpoint.
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import pg from 'pg'

loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)))

if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('Separate test database required')
}

let text = ''

for await (const chunk of process.stdin) {
  text += chunk
}

const input = JSON.parse(text)

const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })

await db.connect()

try {
  await db.query('BEGIN')

  let result

  if (input.action === 'user') {
    const id = randomUUID()

    const token = randomBytes(32).toString('base64url')

    await db.query(
      'INSERT INTO users(id,login,salt,"passwordHash","createdAt") VALUES($1,$2,$3,$4,NOW())',
      [
        id,
        'e2e_' + id.replaceAll('-', ''),
        randomBytes(16).toString('hex'),
        randomBytes(64).toString('hex'),
      ],
    )
    await db.query(
      'INSERT INTO auth_sessions(hash,"userId","expiresAt") VALUES($1,$2,NOW()+INTERVAL \'1 day\')',
      [createHash('sha256').update(token).digest('hex'), id],
    )
    // Each browser test is isolated from the previous tests' IP handshake budget.
    await db.query('DELETE FROM dice_limits WHERE key=$1', [
      createHash('sha256').update('handshake:127.0.0.1').digest('hex'),
    ])
    // Funding exists only in this isolated test fixture, never on registration.
    await db.query('INSERT INTO dice_wallets(user_id,balance,version) VALUES($1,1000000,1)', [id])
    await db.query(
      "INSERT INTO dice_entries(id,user_id,reason,delta,balance_after) VALUES($1,$2,'PAYOUT',1000000,1000000)",
      [randomUUID(), id],
    )
    result = { id, token }
  } else {
    const { rows } = await db.query("SELECT id FROM users WHERE id=$1 AND login LIKE 'e2e_%'", [
      input.user,
    ])

    if (!rows.length) {
      throw new Error('Fixture user required')
    }

    if (input.action === 'bonus' || input.action === 'bonuswallet') {
      const id = randomUUID()

      const game = input.game === 'chest' ? 'chest' : 'caches'

      const rounds = game === 'chest' ? 2 : 10

      await db.query(
        "INSERT INTO bonus_draws(id,user_id,mode,period,prize_index,game,rounds,stake,wager_multiplier,round_days,claimed_at) VALUES($1,$2,'welcome','welcome',1,$3,$4,1000,2,7,NOW())",
        [id, input.user, game, rounds],
      )
      await db.query(
        "INSERT INTO bonus_grants(id,user_id,game,stake,remaining,expires_at,wager_multiplier) VALUES($1,$2,$3,1000,$4,NOW()+INTERVAL '7 days',2)",
        [id, input.user, game, rounds],
      )

      if (input.action === 'bonuswallet') {
        await db.query(
          'UPDATE bonus_grants SET remaining=0,winnings=20000,balance=20000,required=40000,wagered=39000 WHERE id=$1',
          [id],
        )
      }

      result = { id }
    } else if (input.action === 'draw') {
      const id = randomUUID()

      await db.query(
        "INSERT INTO jackpot_periods(id,pool,starts_at,ends_at,amount,total_weight,status,winner_id,drawn_at) VALUES($1,'mini',clock_timestamp()-INTERVAL '2 hours',clock_timestamp()-INTERVAL '1 hour',50000,10000,'DRAWN',$2,NOW())",
        [id, input.winner ?? input.user],
      )
      await db.query(
        'INSERT INTO jackpot_participants(period_id,user_id,weight) VALUES($1,$2,10000)',
        [id, input.user],
      )

      if (input.winner && input.winner !== input.user) {
        await db.query(
          'INSERT INTO jackpot_participants(period_id,user_id,weight) VALUES($1,$2,10000)',
          [id, input.winner],
        )
        await db.query('UPDATE jackpot_periods SET total_weight=20000 WHERE id=$1', [id])
      }

      result = { id }
    } else if (input.action === 'chest4' || input.action === 'chest5') {
      const v5 = input.action === 'chest5'

      const module = await import(v5 ? '../dist/games/chest-v5.js' : '../dist/games/chest-v4.js')

      const chestV4Value = v5 ? module.chestV5Value : module.chestV4Value

      const CHEST_V4_SURVIVAL = v5 ? module.CHEST_V5_SURVIVAL : module.CHEST_V4_SURVIVAL

      const id = randomUUID()

      const stage = v5 ? (input.stage === 7 ? 7 : 6) : input.stage === 5 ? 5 : 4

      const lastStage = v5 ? 7 : 5

      let value = { n: 0n, d: 1n }

      for (let i = 1; i <= stage; i++) {
        value = chestV4Value('10000', i, value)
      }

      const next = stage < lastStage ? chestV4Value('10000', stage + 1, value) : { n: 0n, d: 1n }

      const gold =
        stage < lastStage ? chestV4Value('10000', stage + 1, value, 'gold') : { n: 0n, d: 1n }

      const state = {
        phase: 'offer',
        stage,
        items: Array.from({ length: stage }, (_, i) => ['acorn', 'dew', 'flower'][i % 3]),
        offerMinor: String(value.n / value.d),
        valueNumerator: String(value.n),
        valueDenominator: String(value.d),
        nextPayoutMinor: String(next.n / next.d),
        nextGoldenPayoutMinor: String(gold.n / gold.d),
        nextChanceNumerator: CHEST_V4_SURVIVAL[stage] ?? 0,
        nextChanceDenominator: 100,
        lastKey: null,
      }

      await db.query(
        "INSERT INTO original_rounds(id,user_id,game,stake,active,rules_version,state,payout) VALUES($1,$2,'chest',10000,TRUE,$4,$3,0)",
        [id, input.user, JSON.stringify(state), v5 ? 'chest-5' : 'chest-4'],
      )
      result = { id }
    } else if (input.action === 'chest') {
      const id = randomUUID()

      const state = {
        phase: 'offer',
        stage: 6,
        items: ['acorn', 'dew', 'flower', 'acorn', 'dew', 'flower'],
        offerMinor: '160000',
        nextPayoutMinor: '400000',
        nextGoldenPayoutMinor: '800000',
        nextChanceNumerator: 40,
        nextChanceDenominator: 103,
        lastKey: 'gold',
        boostNumerator: 2,
        boostDenominator: 1,
      }

      if (input.keyKind === 'silver') {
        Object.assign(state, { lastKey: 'silver', beforeKeyMinor: '100000', offerMinor: '150000' })
      }

      if (input.fixedBonus) {
        Object.assign(state, {
          beforeKeyMinor: '77500',
          valueNumerator: '160000',
          valueDenominator: '1',
          nextGoldenPayoutMinor: '805000',
          nextChanceNumerator: 388325951,
          nextChanceDenominator: 1000000000,
        })
      }

      await db.query(
        "INSERT INTO original_rounds(id,user_id,game,stake,active,rules_version,state,payout) VALUES($1,$2,'chest',10000,$3,$5,$4,0)",
        [id, input.user, true, JSON.stringify(state), input.fixedBonus ? 'chest-3' : 'chest-2'],
      )

      result = { id }
    } else if (input.action === 'caches') {
      const id = randomUUID()

      const state = {
        phase: 'offer',
        found: 1,
        current: 0,
        opened: [{ index: 0, result: 'treasure', rank: 1, payoutMinor: '19200' }],
        offerMinor: '19200',
        nextPayoutMinor: '48000',
        nextChance: 40,
      }

      await db.query(
        "INSERT INTO original_rounds(id,user_id,game,stake,active,rules_version,state,secret) VALUES($1,$2,'caches',10000,TRUE,'caches-network-1',$3,$4)",
        [id, input.user, JSON.stringify(state), JSON.stringify({ mask: 7 })],
      )
      result = { id }
    } else if (input.action === 'collection') {
      const id = randomUUID()

      const state = {
        phase: 'settled',
        finding: 'crystal',
        mode: 'outer',
        keyMultiplier: 1,
        offerMinor: '7500',
        crystalAwardMinor: '2500',
        target: 0,
        lastSpin: { kind: 'outer', angle: Math.PI / 8 },
        message: 'Печать раскрыта!',
      }

      await db.query(
        'INSERT INTO original_progress(user_id,crystals,crystal_bonus) VALUES($1,5,0)',
        [input.user],
      )
      await db.query(
        "INSERT INTO original_rounds(id,user_id,game,stake,active,rules_version,state,payout) VALUES($1,$2,'forest',10000,FALSE,'forest-1',$3,7500)",
        [id, input.user, JSON.stringify(state)],
      )
      result = { id }
    } else if (input.action === 'forest') {
      const id = randomUUID()

      const state = {
        phase: input.phase ?? 'coin',
        finding: 'coin',
        mode: 'outer',
        keyMultiplier: 1,
        offerMinor: '14000',
        crystalAwardMinor: '0',
        target: 0,
        lastSpin: { kind: 'outer', angle: 0 },
        message: 'Забери находку или испытай удачу.',
      }

      await db.query(
        "INSERT INTO original_rounds(id,user_id,game,stake,active,rules_version,state) VALUES($1,$2,'forest',10000,TRUE,'forest-1',$3)",
        [id, input.user, JSON.stringify(state)],
      )
      result = { id }
    } else {
      throw new Error('Unknown fixture')
    }
  }

  await db.query('COMMIT')
  process.stdout.write(JSON.stringify(result))
} finally {
  await db.end()
}
