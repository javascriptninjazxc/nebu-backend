import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { calculateSpinOutcome } from '../dist/games/chest-v5.js'
import { chestFraction } from '../dist/games/chest-rules.js'
import { OriginalsRandom } from '../dist/games/random.js'

const dir = new URL('../../docs/design-research/greedy-chest/sessions-10000/', import.meta.url)

const config = {
  rules: 'chest-5',
  sessions: 10000,
  depositRange: [100, 100000],
  depositDistribution: 'log-uniform; whole rubles',
  betFractionOfInitialDeposit: 0.02,
  minBet: 10,
  maxPaidRounds: 100,
  takeProfit: 2,
  strategy: 'one target item uniformly sampled from 1..7 per session',
  roundDurationSeconds: 30,
  currency: 'RUB-equivalent mathematical simulation, not live money',
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
  throw Error('Replay mismatch')
}

const rng = new OriginalsRandom()

const draws = old?.draws ?? []

let cursor = 0

function random(upper) {
  if (replay) {
    const [bound, value] = draws[cursor++] ?? []

    if (bound !== Number(upper)) {
      throw Error('Draw mismatch')
    }

    return BigInt(value)
  }

  const value = rng.weighted(upper)

  draws.push([Number(upper), Number(value)])
  cursor++

  return value
}

const sessions = []

const roundRows = [
  'session,round,stakeMinor,target,payoutMinor,balanceMinor,lossRiskStep,silver,gold',
]

let gross = 0n

let peak = 0n

let minGross = 0n

let drawdown = 0n

let silverTotal = 0

let goldTotal = 0

let itemTotal = 0

let maxSinglePayout = 0n

const trajectory = []

for (let i = 1; i <= config.sessions; i++) {
  const u = Number(random(1000000000n)) / 1e9

  const deposit = Math.max(100, Math.min(100000, Math.round(100 * 1000 ** u)))

  const initial = BigInt(deposit) * 100n

  const target = Number(random(7n)) + 1

  const nominalBet = BigInt(Math.max(10, Math.floor(deposit * 0.02))) * 100n

  let balance = initial

  let paidRounds = 0

  let turnover = 0n

  let paid = 0n

  let zeros = 0

  let profitableRounds = 0

  let successItems = 0

  let silver = 0

  let gold = 0

  let localMax = 0n

  let reason = 'round_limit'

  while (paidRounds < 100) {
    if (balance < 1000n) {
      reason = 'below_min_bet'
      break
    }

    if (balance >= 2n * initial) {
      reason = 'deposit_doubled'
      break
    }

    const stake = balance < nominalBet ? (balance / 100n) * 100n : nominalBet

    if (stake < 1000n) {
      throw Error('Invalid simulated stake')
    }

    balance -= stake
    turnover += stake
    paidRounds++

    let current = chestFraction(0n)

    let lossRisk = null

    let roundSilver = 0

    let roundGold = 0

    for (let stage = 0; stage < target; stage++) {
      const result = calculateSpinOutcome(String(stake), current, stage, random)

      current = result.value

      if (result.closed) {
        lossRisk = stage
        break
      }

      successItems++
      roundSilver += Number(result.key === 'silver')
      roundGold += Number(result.key === 'gold')
    }

    const payout = current.n / current.d

    balance += payout
    paid += payout
    silver += roundSilver
    gold += roundGold
    zeros += Number(payout === 0n)
    profitableRounds += Number(payout > stake)

    if (payout > localMax) {
      localMax = payout
    }

    if (payout > maxSinglePayout) {
      maxSinglePayout = payout
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

    roundRows.push(
      [i, paidRounds, stake, target, payout, balance, lossRisk ?? '', roundSilver, roundGold].join(
        ',',
      ),
    )

    if (balance < 1000n) {
      reason = 'below_min_bet'
      break
    }

    if (balance >= 2n * initial) {
      reason = 'deposit_doubled'
      break
    }
  }

  if (initial - turnover + paid !== balance) {
    throw Error('Wallet invariant failed')
  }

  sessions.push({
    id: i,
    depositMinor: String(initial),
    target,
    nominalStakeMinor: String(nominalBet),
    paidRounds,
    turnoverMinor: String(turnover),
    paidMinor: String(paid),
    balanceMinor: String(balance),
    casinoGrossMinor: String(initial - balance),
    reason,
    zeroPayoutRounds: zeros,
    profitableRounds,
    silver,
    gold,
    successfulItems: successItems,
    maxPayoutMinor: String(localMax),
  })
  silverTotal += silver
  goldTotal += gold
  itemTotal += successItems
  trajectory.push({ session: i, casinoGross: Number(gross) / 100 })
}

if (replay && cursor !== draws.length) {
  throw Error('Unused replay draws')
}

const sum = (rows, key) => rows.reduce((a, r) => a + BigInt(r[key]), 0n)

const rub = (n) => Number(n) / 100

const quantile = (values, q) => {
  const a = [...values].sort((a, b) => a - b)

  return a[Math.max(0, Math.ceil(a.length * q) - 1)] ?? 0
}

function summarize(rows) {
  const dep = sum(rows, 'depositMinor')

  const turn = sum(rows, 'turnoverMinor')

  const paid = sum(rows, 'paidMinor')

  const balances = sum(rows, 'balanceMinor')

  const profit = turn - paid

  if (dep - balances !== profit) {
    throw Error('Aggregate invariant failed')
  }

  const rounds = rows.reduce((a, r) => a + r.paidRounds, 0)

  return {
    sessions: rows.length,
    deposits: rub(dep),
    turnover: rub(turn),
    payouts: rub(paid),
    endingBalances: rub(balances),
    casinoGross: rub(profit),
    rtpPercent: (Number(paid) / Number(turn)) * 100,
    marginPercent: (Number(profit) / Number(turn)) * 100,
    theoreticalRtpPercent: 95.996,
    edgeTimesObservedTurnover: rub(turn) * 0.04004,
    paidRounds: rounds,
    averageRounds: rounds / rows.length,
    averageDeposit: rub(dep) / rows.length,
    averageStake: rub(turn) / rounds,
    turnoverToDeposits: Number(turn) / Number(dep),
    zeroPayoutRounds: rows.reduce((a, r) => a + r.zeroPayoutRounds, 0),
    profitableRounds: rows.reduce((a, r) => a + r.profitableRounds, 0),
    playersAhead: rows.filter((r) => BigInt(r.balanceMinor) > BigInt(r.depositMinor)).length,
    playersEven: rows.filter((r) => r.balanceMinor === r.depositMinor).length,
    playersBehind: rows.filter((r) => BigInt(r.balanceMinor) < BigInt(r.depositMinor)).length,
    stoppedBelowMin: rows.filter((r) => r.reason === 'below_min_bet').length,
    stoppedAtDouble: rows.filter((r) => r.reason === 'deposit_doubled').length,
    stoppedAtLimit: rows.filter((r) => r.reason === 'round_limit').length,
    medianPlayerNet: quantile(
      rows.map((r) => rub(BigInt(r.balanceMinor) - BigInt(r.depositMinor))),
      0.5,
    ),
    playerNetP05: quantile(
      rows.map((r) => rub(BigInt(r.balanceMinor) - BigInt(r.depositMinor))),
      0.05,
    ),
    playerNetP95: quantile(
      rows.map((r) => rub(BigInt(r.balanceMinor) - BigInt(r.depositMinor))),
      0.95,
    ),
    maxPayout: Math.max(...rows.map((r) => rub(BigInt(r.maxPayoutMinor)))),
  }
}

const main = summarize(sessions)

const byDeposit = [
  [100, 999],
  [1000, 9999],
  [10000, 100000],
].map(([a, b]) => ({
  range: a + '–' + b,
  ...summarize(
    sessions.filter((s) => Number(s.depositMinor) / 100 >= a && Number(s.depositMinor) / 100 <= b),
  ),
}))

const byStrategy = Array.from({ length: 7 }, (_, i) => ({
  stopAfter: i + 1,
  ...summarize(sessions.filter((s) => s.target === i + 1)),
}))

const summary = {
  config,
  sourceHash,
  generatedAt: old?.generatedAt ?? new Date().toISOString(),
  main,
  byDeposit,
  byStrategy,
  keys: { silver: silverTotal, gold: goldTotal, successfulItems: itemTotal },
  cashflow: {
    maximumPeakToTroughDrawdown: rub(drawdown),
    maximumCumulativeDeficitFromZero: rub(-minGross),
    largestSinglePayout: rub(maxSinglePayout),
    ordering: 'sessions sequentially, rounds chronologically; not a recommended reserve',
  },
  topPlayers: [...sessions]
    .sort((a, b) =>
      Number(
        BigInt(b.balanceMinor) -
          BigInt(b.depositMinor) -
          (BigInt(a.balanceMinor) - BigInt(a.depositMinor)),
      ),
    )
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      deposit: rub(BigInt(s.depositMinor)),
      target: s.target,
      rounds: s.paidRounds,
      endingBalance: rub(BigInt(s.balanceMinor)),
      net: rub(BigInt(s.balanceMinor) - BigInt(s.depositMinor)),
      maxPayout: rub(BigInt(s.maxPayoutMinor)),
    })),
}

await mkdir(dir, { recursive: true })
await writeFile(
  new URL('draws.json', dir),
  JSON.stringify({ config, sourceHash, generatedAt: summary.generatedAt, draws }),
)
await writeFile(new URL('summary.json', dir), JSON.stringify(summary, null, 2))
await writeFile(new URL('sessions.json', dir), JSON.stringify(sessions))
await writeFile(new URL('rounds.csv', dir), roundRows.join('\n') + '\n')

const columns = Object.keys(sessions[0])

await writeFile(
  new URL('sessions.csv', dir),
  columns.join(',') +
    '\n' +
    sessions.map((s) => columns.map((k) => s[k]).join(',')).join('\n') +
    '\n',
)
await writeFile(
  new URL('cashflow.csv', dir),
  'session,casinoGrossRub\n' +
    trajectory.map((s) => s.session + ',' + s.casinoGross).join('\n') +
    '\n',
)
console.log(JSON.stringify(summary, null, 2))
