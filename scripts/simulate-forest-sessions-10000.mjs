import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { OriginalsService } from '../dist/games/originals.service.js'
import { OriginalsRandom, FOREST_SECTORS, forestPay } from '../dist/games/random.js'

// Runs the real forest state machine with an in-memory account adapter. No DB or HTTP.
const dir = new URL('../../docs/design-research/heart-of-forest/sessions-10000/', import.meta.url)

const priorBytes = await readFile(
  new URL('../../docs/design-research/greedy-chest/sessions-10000/sessions.json', import.meta.url),
)

const prior = JSON.parse(priorBytes)

assert.equal(prior.length, 10000)

const strategies = ['cashout_open', 'risk_open', 'cashout_charge', 'risk_charge']

const config = {
  rules: 'forest-1',
  sessions: 10000,
  depositRange: [100, 100000],
  depositDistribution:
    'Exact same deposit vector as previous chest session test; log-uniform, whole RUB',
  depositHash: createHash('sha256').update(priorBytes).digest('hex'),
  betFractionOfInitialDeposit: 0.02,
  minBet: 10,
  maxPaidRounds: 100,
  takeProfit: 2,
  strategies,
  allocation: '2500 sessions each; assigned cyclically before any outcomes',
  initialCrystalProgress: 0,
  unclaimedCrystals:
    'Carried across rounds in a session; retained as pending entitlement at session end, not cashed out',
  bonuses: 'Only native forest crystal bonus; no external promotions',
  currency: 'RUB-equivalent simulation; no live accounts',
}

const hasher = createHash('sha256')

for (const name of ['originals.service.js', 'random.js']) {
  hasher.update(await readFile(new URL('../dist/games/' + name, import.meta.url)))
}

const sourceHash = hasher.digest('hex')

const replay = process.argv.includes('--replay')

const old = replay ? JSON.parse(await readFile(new URL('draws.json', dir), 'utf8')) : null

if (old) {
  assert.equal(old.sourceHash, sourceHash)
  assert.deepEqual(old.config, config)
}

const rng = new OriginalsRandom()

const draws = old?.draws ?? []

let cursor = 0

function draw(bound) {
  if (replay) {
    const pair = draws[cursor++]

    assert(pair)
    assert.equal(pair[0], bound)
    assert(pair[1] >= 0 && pair[1] < bound)

    return pair[1]
  }

  const value = Number(rng.weighted(BigInt(bound)))

  draws.push([bound, value])
  cursor++

  return value
}

const sessions = []

const rounds = [
  'session,round,strategy,stakeMinor,outer,chargeWon,innerWon,coinRiskWon,payoutMinor,balanceMinor,crystalBonusMinor,pendingCrystalMinor',
]

let gross = 0n

let peak = 0n

let minGross = 0n

let drawdown = 0n

const trajectory = []

const outcomes = {
  bankrupt: 0,
  coin: 0,
  crystal: 0,
  key: 0,
  coinRiskAttempts: 0,
  coinRiskWins: 0,
  chargeAttempts: 0,
  chargeWins: 0,
  innerSpins: 0,
  innerWins: 0,
  crystalBonuses: 0,
}

for (let i = 0; i < config.sessions; i++) {
  const initial = BigInt(prior[i].depositMinor)

  assert(initial >= 10000n && initial <= 10000000n)

  const strategy = strategies[i % 4]

  const riskCoin = strategy.startsWith('risk')

  const charge = strategy.endsWith('charge')

  const deposit = Number(initial / 100n)

  const nominal = BigInt(Math.max(10, Math.floor(deposit * 0.02))) * 100n

  let balance = initial

  let turnover = 0n

  let paid = 0n

  let pending = 0n

  let crystals = 0

  let paidRounds = 0

  let zeros = 0

  let profitable = 0

  let maxPayout = 0n

  let bonusPaid = 0n

  let crystalAccrued = 0n

  let expected = 0

  let reason = 'round_limit'

  let credited = 0n

  const account = {
    async rows(sql, params) {
      if (sql.startsWith('INSERT INTO original_progress')) {
        return []
      }

      if (sql.startsWith('SELECT crystals,crystal_bonus')) {
        return [{ crystals, crystal_bonus: String(pending) }]
      }

      if (sql.startsWith('UPDATE original_progress')) {
        crystals = params.count
        pending = BigInt(params.bank)

        return [{ user_id: String(i) }]
      }

      throw Error('Unexpected query: ' + sql)
    },
    async money(user, round, delta, kind, _transaction, source) {
      assert.equal(user, String(i))
      assert.equal(kind, 'PAYOUT')
      assert.equal(source, 'original')
      balance += BigInt(delta)
      credited += BigInt(delta)
    },
  }

  const service = new OriginalsService(
    account,
    { outer: () => draw(16), inner: () => draw(3), risk: () => draw(2) === 0 },
    null,
  )

  while (paidRounds < 100) {
    if (balance < 1000n) {
      reason = 'below_min_bet'
      break
    }

    if (balance >= initial * 2n) {
      reason = 'deposit_doubled'
      break
    }

    const stake = balance < nominal ? (balance / 100n) * 100n : nominal

    assert(stake >= 1000n && stake <= 10000000n && stake % 100n === 0n)
    balance -= stake
    turnover += stake
    paidRounds++
    credited = 0n

    const pay = (n, d = 1n) => BigInt(forestPay(String(stake), n, d))

    // Conditional expectation including accrued (not necessarily already paid) crystal bonus.
    const keyEV = charge
      ? 0.5 * (Number(pay(18n)) / 3 + (2 * Number(pay(2n, 4n))) / 3)
      : Number(pay(9n)) / 3 + (2 * Number(pay(1n, 4n))) / 3

    expected +=
      ((5 / 16) * Number(pay(14n, 10n)) +
        (4 / 16) * (Number(pay(1n, 2n)) + Number(stake / 20n)) +
        (2 / 16) * keyEV) /
      100

    const r = {
      id: `${i}-${paidRounds}`,
      user_id: String(i),
      game: 'forest',
      stake: String(stake),
      active: true,
      version: 1,
      rules_version: 'forest-1',
      payout: '0',
      state: {
        phase: 'settled',
        finding: 'bankrupt',
        mode: 'outer',
        keyMultiplier: 1,
        offerMinor: '0',
        crystalAwardMinor: '0',
        target: 0,
        lastSpin: null,
        message: '',
      },
    }

    await service.forest(r, 'forest.start', {}, undefined)

    const finding = r.state.finding

    outcomes[finding]++

    let chargeWon = ''

    let innerWon = ''

    let coinRiskWon = ''

    if (finding === 'crystal') {
      crystalAccrued += stake / 20n
      bonusPaid += BigInt(r.state.crystalAwardMinor)

      if (BigInt(r.state.crystalAwardMinor) > 0n) {
        outcomes.crystalBonuses++
      }
    }

    if (r.state.phase === 'coin') {
      if (riskCoin) {
        outcomes.coinRiskAttempts++
      }

      await service.forest(r, riskCoin ? 'forest.risk' : 'forest.cashout', {}, undefined)

      if (riskCoin) {
        coinRiskWon = r.payout !== '0'
        outcomes.coinRiskWins += Number(coinRiskWon)
      }
    }

    if (r.state.phase === 'key') {
      if (charge) {
        outcomes.chargeAttempts++
      }

      await service.forest(r, charge ? 'forest.charge' : 'forest.open', {}, undefined)

      if (charge) {
        chargeWon = r.state.phase === 'choose'
        outcomes.chargeWins += Number(chargeWon)
      }
    }

    if (r.state.phase === 'choose') {
      const target = 0 // All 3 symbols equiprobable; fixed choice avoids artificial random decisions.

      await service.forest(r, 'forest.spin', { target }, undefined)
      innerWon = r.state.finding === 'star'
      outcomes.innerSpins++
      outcomes.innerWins += Number(innerWon)
    }

    assert.equal(r.active, false)

    const payout = BigInt(r.payout)

    assert.equal(credited, payout)
    paid += payout
    zeros += Number(payout === 0n)
    profitable += Number(payout > stake)

    if (payout > maxPayout) {
      maxPayout = payout
    }

    gross += stake - payout

    if (gross > peak) {
      peak = gross
    }

    if (gross < minGross) {
      minGross = gross
    }

    if (peak - gross > drawdown) {
      drawdown = peak - gross
    }

    rounds.push(
      [
        i + 1,
        paidRounds,
        strategy,
        stake,
        finding,
        chargeWon,
        innerWon,
        coinRiskWon,
        payout,
        balance,
        r.state.crystalAwardMinor,
        pending,
      ].join(','),
    )

    if (balance < 1000n) {
      reason = 'below_min_bet'
      break
    }

    if (balance >= initial * 2n) {
      reason = 'deposit_doubled'
      break
    }
  }

  assert.equal(initial - turnover + paid, balance)
  assert.equal(crystalAccrued - bonusPaid, pending)
  sessions.push({
    id: i + 1,
    strategy,
    depositMinor: String(initial),
    nominalStakeMinor: String(nominal),
    paidRounds,
    turnoverMinor: String(turnover),
    paidMinor: String(paid),
    balanceMinor: String(balance),
    casinoGrossMinor: String(initial - balance),
    pendingCrystalMinor: String(pending),
    crystalBonusPaidMinor: String(bonusPaid),
    expectedPayoutWithAccrual: expected,
    crystals,
    reason,
    zeroPayoutRounds: zeros,
    profitableRounds: profitable,
    maxPayoutMinor: String(maxPayout),
  })
  trajectory.push({ session: i + 1, casinoGross: Number(gross) / 100 })
}

if (replay) {
  assert.equal(cursor, draws.length)
}

const sum = (rows, key) => rows.reduce((n, r) => n + BigInt(r[key]), 0n)

const rub = (n) => Number(n) / 100

const quantile = (list, q) => {
  const a = [...list].sort((x, y) => x - y)

  return a[Math.max(0, Math.ceil(a.length * q) - 1)] ?? 0
}

function summarize(rows) {
  const dep = sum(rows, 'depositMinor')

  const turn = sum(rows, 'turnoverMinor')

  const paid = sum(rows, 'paidMinor')

  const balance = sum(rows, 'balanceMinor')

  const pending = sum(rows, 'pendingCrystalMinor')

  const profit = turn - paid

  assert.equal(dep - balance, profit)

  const n = rows.reduce((s, r) => s + r.paidRounds, 0)

  const expected = rows.reduce((s, r) => s + r.expectedPayoutWithAccrual, 0)

  return {
    sessions: rows.length,
    deposits: rub(dep),
    turnover: rub(turn),
    payouts: rub(paid),
    endingBalances: rub(balance),
    casinoGross: rub(profit),
    rtpPercent: (Number(paid) / Number(turn)) * 100,
    marginPercent: (Number(profit) / Number(turn)) * 100,
    pendingCrystalBonus: rub(pending),
    casinoGrossAfterPending: rub(profit - pending),
    rtpIncludingPendingPercent: (Number(paid + pending) / Number(turn)) * 100,
    theoreticalUnroundedRtpPercent: 97.08333333333333,
    conditionalExpectedPayoutWithAccrual: expected,
    conditionalExpectedRtpPercent: (expected / rub(turn)) * 100,
    paidRounds: n,
    averageRounds: n / rows.length,
    averageDeposit: rub(dep) / rows.length,
    averageStake: rub(turn) / n,
    turnoverToDeposits: Number(turn) / Number(dep),
    zeroPayoutRounds: rows.reduce((s, r) => s + r.zeroPayoutRounds, 0),
    profitableRounds: rows.reduce((s, r) => s + r.profitableRounds, 0),
    playersAhead: rows.filter((r) => BigInt(r.balanceMinor) > BigInt(r.depositMinor)).length,
    playersEven: rows.filter((r) => r.balanceMinor === r.depositMinor).length,
    playersBehind: rows.filter((r) => BigInt(r.balanceMinor) < BigInt(r.depositMinor)).length,
    stoppedBelowMin: rows.filter((r) => r.reason === 'below_min_bet').length,
    stoppedAtDouble: rows.filter((r) => r.reason === 'deposit_doubled').length,
    stoppedAtLimit: rows.filter((r) => r.reason === 'round_limit').length,
    crystalBonusesPaid: rub(sum(rows, 'crystalBonusPaidMinor')),
    medianPlayerNet: quantile(
      rows.map((r) => rub(BigInt(r.balanceMinor) - BigInt(r.depositMinor))),
      0.5,
    ),
    maxPayout: Math.max(...rows.map((r) => rub(BigInt(r.maxPayoutMinor)))),
  }
}

assert.equal(FOREST_SECTORS.filter((x) => x === 'coin').length, 5)
assert.equal(FOREST_SECTORS.filter((x) => x === 'crystal').length, 4)
assert.equal(FOREST_SECTORS.filter((x) => x === 'key').length, 2)

const summary = {
  config,
  sourceHash,
  generatedAt: old?.generatedAt ?? new Date().toISOString(),
  main: summarize(sessions),
  byStrategy: strategies.map((strategy) => ({
    strategy,
    ...summarize(sessions.filter((r) => r.strategy === strategy)),
  })),
  byDeposit: [
    [100, 999],
    [1000, 9999],
    [10000, 100000],
  ].map(([a, b]) => ({
    range: `${a}-${b}`,
    ...summarize(
      sessions.filter(
        (r) => Number(r.depositMinor) / 100 >= a && Number(r.depositMinor) / 100 <= b,
      ),
    ),
  })),
  outcomes,
  cashflow: {
    maximumPeakToTroughDrawdown: rub(drawdown),
    maximumCumulativeDeficitFromZero: rub(-minGross),
    ordering: 'Sequential sessions and rounds; descriptive only, not a bankroll recommendation',
  },
}

await mkdir(dir, { recursive: true })
await writeFile(
  new URL('draws.json', dir),
  JSON.stringify({ config, sourceHash, generatedAt: summary.generatedAt, draws }),
)
await writeFile(new URL('summary.json', dir), JSON.stringify(summary, null, 2))
await writeFile(new URL('sessions.json', dir), JSON.stringify(sessions))
await writeFile(new URL('rounds.csv', dir), rounds.join('\n') + '\n')

const columns = Object.keys(sessions[0])

await writeFile(
  new URL('sessions.csv', dir),
  columns.join(',') +
    '\n' +
    sessions.map((r) => columns.map((k) => r[k]).join(',')).join('\n') +
    '\n',
)
await writeFile(
  new URL('cashflow.csv', dir),
  'session,casinoGrossRub\n' +
    trajectory.map((r) => r.session + ',' + r.casinoGross).join('\n') +
    '\n',
)
console.log(JSON.stringify(summary, null, 2))
