import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { calculateSpinOutcome, CHEST_V5_SURVIVAL } from '../dist/games/chest-v5.js'
import { chestFraction } from '../dist/games/chest-rules.js'
import { OriginalsRandom } from '../dist/games/random.js'

const dir = new URL('../../docs/design-research/greedy-chest/ev-10000/', import.meta.url)

const config = {
  rules: 'chest-5',
  rounds: 10000,
  minStake: 100,
  maxStake: 100000,
  stakeDistribution: 'log-uniform, rounded to whole rubles',
  strategy: 'uniform target item 1..7 chosen before outcome',
  accounts: 'one distinct player per paid round; Free Push limits cannot bind',
  currency: 'RUB-equivalent simulation only; no wallets touched',
}

const hasher = createHash('sha256')

for (const name of ['chest-v5.js', 'chest-rules.js', 'random.js']) {
  hasher.update(await readFile(new URL('../dist/games/' + name, import.meta.url)))
}

const sourceHash = hasher.digest('hex')

const replay = process.argv.includes('--replay')

const old = replay ? JSON.parse(await readFile(new URL('draws.json', dir), 'utf8')) : null

if (
  old &&
  (old.sourceHash !== sourceHash || JSON.stringify(old.config) !== JSON.stringify(config))
) {
  throw Error('Replay math or config changed')
}

const draws = old?.draws ?? []

const rng = new OriginalsRandom()

let cursor = 0

function random(upper) {
  if (replay) {
    const pair = draws[cursor++]

    if (!pair || pair[0] !== String(upper)) {
      throw Error('Replay mismatch')
    }

    return BigInt(pair[1])
  }

  const value = rng.weighted(upper)

  draws.push([String(upper), String(value)])
  cursor++

  return value
}

const rows = []

for (let i = 0; i < config.rounds; i++) {
  const u = Number(random(1000000000n)) / 1e9

  const stake = Math.max(100, Math.min(100000, Math.round(100 * 1000 ** u)))

  const stakeMinor = BigInt(stake) * 100n

  const target = Number(random(7n)) + 1

  let current = chestFraction(0n)

  let closed = false

  let lostAt = null

  let silver = 0

  let gold = 0

  const payouts = []

  const steps = []

  for (let stage = 0; stage < 7; stage++) {
    if (!closed) {
      const outcome = calculateSpinOutcome(String(stakeMinor), current, stage, random)

      current = outcome.value
      closed = outcome.closed

      if (closed) {
        lostAt = stage + 1
      }

      if (stage < target) {
        silver += Number(outcome.key === 'silver')
        gold += Number(outcome.key === 'gold')
      }

      steps.push({ item: stage + 1, closed, key: outcome.key })
    }

    payouts.push(String(current.n / current.d))
  }

  const payoutMinor = BigInt(payouts[target - 1])

  const actualLostAt = lostAt && lostAt <= target ? lostAt : null

  rows.push({
    round: i + 1,
    stakeMinor: String(stakeMinor),
    target,
    payoutMinor: String(payoutMinor),
    lostAt: actualLostAt,
    silver,
    gold,
    counterfactualPayoutsMinor: payouts,
    steps,
  })
}

if (replay && cursor !== draws.length) {
  throw Error('Unused draws')
}

const sum = (list, fn) => list.reduce((s, r) => s + BigInt(fn(r)), 0n)

const rub = (x) => Number(x) / 100

function summarize(list, pick = (r) => r.payoutMinor) {
  const staked = sum(list, (r) => r.stakeMinor)

  const paid = sum(list, pick)

  const gross = staked - paid

  const sorted = list.map((r) => rub(BigInt(pick(r)))).sort((a, b) => a - b)

  let pnl = 0n

  let peak = 0n

  let minPnl = 0n

  let maxDrawdown = 0n

  for (const r of list) {
    pnl += BigInt(r.stakeMinor) - BigInt(pick(r))

    if (pnl > peak) {
      peak = pnl
    }

    if (pnl < minPnl) {
      minPnl = pnl
    }

    if (peak - pnl > maxDrawdown) {
      maxDrawdown = peak - pnl
    }
  }

  return {
    rounds: list.length,
    turnover: rub(staked),
    paid: rub(paid),
    casinoGross: rub(gross),
    rtpPercent: (Number(paid) / Number(staked)) * 100,
    marginPercent: (Number(gross) / Number(staked)) * 100,
    expectedGrossBeforeRounding: (Number(staked) * 0.04004) / 100,
    averageStake: rub(staked) / list.length,
    averagePayout: rub(paid) / list.length,
    playerNetEV: rub(-gross) / list.length,
    positivePayouts: list.filter((r) => BigInt(pick(r)) > 0n).length,
    playerProfitableRounds: list.filter((r) => BigInt(pick(r)) > BigInt(r.stakeMinor)).length,
    zeroPayouts: list.filter((r) => BigInt(pick(r)) === 0n).length,
    maxPayout: sorted.at(-1) ?? 0,
    payoutP99: sorted[Math.max(0, Math.ceil(list.length * 0.99) - 1)] ?? 0,
    maxCasinoDrawdown: rub(maxDrawdown),
    largestCumulativeDeficit: rub(-minPnl),
  }
}

const main = summarize(rows)

const byStake = [
  [100, 999],
  [1000, 9999],
  [10000, 100000],
].map(([min, max]) => ({
  range: min + '–' + max,
  ...summarize(
    rows.filter((r) => Number(r.stakeMinor) / 100 >= min && Number(r.stakeMinor) / 100 <= max),
  ),
}))

const strategies = Array.from({ length: 7 }, (_, i) => ({
  stopAfter: i + 1,
  ...summarize(rows, (r) => r.counterfactualPayoutsMinor[i]),
  expectedSuccessfulRounds:
    10000 * CHEST_V5_SURVIVAL.slice(0, i + 1).reduce((p, n) => (p * n) / 100, 1),
}))

const byTarget = Array.from({ length: 7 }, (_, i) => ({
  target: i + 1,
  ...summarize(rows.filter((r) => r.target === i + 1)),
}))

const keyTotals = rows.reduce((a, r) => ({ silver: a.silver + r.silver, gold: a.gold + r.gold }), {
  silver: 0,
  gold: 0,
})

const actualSuccesses = rows.reduce(
  (n, r) => n + r.steps.filter((s) => s.item <= r.target && !s.closed).length,
  0,
)

const topWins = [...rows]
  .sort((a, b) => Number(BigInt(b.payoutMinor) - BigInt(a.payoutMinor)))
  .slice(0, 10)
  .map((r) => ({
    round: r.round,
    stake: rub(BigInt(r.stakeMinor)),
    target: r.target,
    payout: rub(BigInt(r.payoutMinor)),
    silver: r.silver,
    gold: r.gold,
  }))

const result = {
  config,
  sourceHash,
  generatedAt: old?.generatedAt ?? new Date().toISOString(),
  main,
  byStake,
  strategies,
  byTarget,
  keys: { ...keyTotals, successfulItems: actualSuccesses },
  topWins,
}

await mkdir(dir, { recursive: true })
await writeFile(
  new URL('draws.json', dir),
  JSON.stringify({ config, sourceHash, generatedAt: result.generatedAt, draws }),
)
await writeFile(new URL('summary.json', dir), JSON.stringify(result, null, 2))
await writeFile(new URL('rounds.json', dir), JSON.stringify(rows))

const columns = ['round', 'stakeMinor', 'target', 'payoutMinor', 'lostAt', 'silver', 'gold']

await writeFile(
  new URL('rounds.csv', dir),
  columns.join(',') +
    '\n' +
    rows.map((r) => columns.map((k) => r[k] ?? '').join(',')).join('\n') +
    '\n',
)
console.log(JSON.stringify(result, null, 2))
