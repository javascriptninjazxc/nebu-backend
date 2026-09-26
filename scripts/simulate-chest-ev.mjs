import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { calculateSpinOutcome, chestV4Value, CHEST_V4_SURVIVAL } from '../dist/games/chest-v4.js'
import { chestFraction } from '../dist/games/chest-rules.js'
import { OriginalsRandom } from '../dist/games/random.js'

const destination = new URL('../../docs/design-research/greedy-chest/ev-1000/', import.meta.url)

const rounds = 1000

const stakeMinor = '10000'

const stake = 100

const sourceHash = createHash('sha256')
  .update(await readFile(new URL('../dist/games/chest-v4.js', import.meta.url)))
  .digest('hex')

const replay = process.argv.includes('--replay')

const saved = replay ? JSON.parse(await readFile(new URL('draws.json', destination), 'utf8')) : null

if (
  saved &&
  (saved.sourceHash !== sourceHash || saved.rounds !== rounds || saved.stakeMinor !== stakeMinor)
) {
  throw new Error('Replay configuration or compiled math differs')
}

const rng = new OriginalsRandom()

const draws = saved?.draws ?? []

let drawIndex = 0

const random = (upper) => {
  if (replay) {
    const draw = draws[drawIndex++]

    if (!draw || draw.upper !== String(upper)) {
      throw new Error('Replay draw mismatch')
    }

    return BigInt(draw.value)
  }

  const value = rng.weighted(upper)

  draws.push({ upper: String(upper), value: String(value) })
  drawIndex++

  return value
}

const payouts = Array.from({ length: 5 }, () => [])

const counts = Array.from({ length: 5 }, () => ({
  attempts: 0,
  successes: 0,
  losses: 0,
  silver: 0,
  gold: 0,
}))

const records = []

for (let round = 1; round <= rounds; round++) {
  let current = chestFraction(0n)

  let lost = false

  const row = { round, stake, steps: [] }

  for (let stage = 0; stage < 5; stage++) {
    if (!lost) {
      counts[stage].attempts++

      const result = calculateSpinOutcome(stakeMinor, current, stage, random)

      current = result.value
      lost = result.closed

      if (lost) {
        counts[stage].losses++
      } else {
        counts[stage].successes++

        if (result.key) {
          counts[stage][result.key]++
        }
      }

      row.steps.push({ stage: stage + 1, closed: lost, key: result.key })
    }

    const payout = Number(current.n / current.d) / 100

    payouts[stage].push(payout)
    row['payoutAfter' + (stage + 1)] = payout
  }

  records.push(row)
}

if (replay && drawIndex !== draws.length) {
  throw new Error('Unused replay draws')
}

// Enumerate all successful key histories; lost branches pay zero.
// Flooring is exactly the server cashout floor in minor units.
let states = [{ value: chestFraction(0n), probability: 1 }]

const theory = []

for (let stage = 1; stage <= 5; stage++) {
  const next = []

  for (const state of states) {
    for (const [key, chance] of [
      [null, 0.945],
      ['silver', 0.05],
      ['gold', 0.005],
    ]) {
      next.push({
        value: chestV4Value(stakeMinor, stage, state.value, key),
        probability: ((state.probability * CHEST_V4_SURVIVAL[stage - 1]) / 100) * chance,
      })
    }
  }

  states = next

  const mean = states.reduce(
    (sum, s) => sum + (s.probability * Number(s.value.n / s.value.d)) / 100,
    0,
  )

  const second = states.reduce(
    (sum, s) => sum + s.probability * (Number(s.value.n / s.value.d) / 100) ** 2,
    0,
  )

  theory.push({ mean, sd: Math.sqrt(Math.max(0, second - mean * mean)) })
}

const summary = payouts.map((values, index) => {
  const total = values.reduce((sum, x) => sum + Math.round(x * 100), 0) / 100

  const mean = total / rounds

  const expected = theory[index]

  const halfWidth = (1.96 * expected.sd) / Math.sqrt(rounds)

  return {
    stopAfterItem: index + 1,
    rounds,
    stake,
    totalStaked: rounds * stake,
    totalPaid: total,
    meanPayout: mean,
    netEV: mean - stake,
    rtpPercent: (mean / stake) * 100,
    theoreticalMean: expected.mean,
    theoreticalRtpPercent: (expected.mean / stake) * 100,
    deviationPP: ((mean - expected.mean) / stake) * 100,
    approximate95MeanRange: [expected.mean - halfWidth, expected.mean + halfWidth],
    ...counts[index],
  }
})

const metadata = {
  rules: 'chest-4',
  rounds,
  stakeMinor,
  sourceHash,
  generatedAt: saved?.generatedAt ?? new Date().toISOString(),
  draws,
}

const n = (x) => x.toFixed(4)

const table = [
  '| Остановка после предмета | Раундов | Выплачено | Средняя выплата | Чистый EV | RTP, % | Теор. средняя* | Отклонение, п.п. | Диапазон среднего ≈95% |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---|',
  ...summary.map(
    (s) =>
      '| ' +
      [
        s.stopAfterItem,
        s.rounds,
        n(s.totalPaid),
        n(s.meanPayout),
        n(s.netEV),
        n(s.rtpPercent),
        n(s.theoreticalMean),
        n(s.deviationPP),
        s.approximate95MeanRange.map(n).join(' – '),
      ].join(' | ') +
      ' |',
  ),
].join('\n')

const report =
  '# Greedy Chest: 1000 симуляций\n\nСтавка: 100 фишек. Правила: chest-4. Free Push исключён.\n\n' +
  'Это 1000 независимых полных траекторий. Для каждой сравниваются пять заранее фиксированных стратегий: забрать после 1/2/3/4/5 предмета. После потери все последующие результаты равны нулю. Поэтому в каждой строке знаменатель 1000; строки зависимы между собой, это не 5000 независимых раундов.\n\n' +
  table +
  '\n\n*Теоретическая средняя получена полным перебором ветвей с серверным округлением выплаты вниз до 0,01. Без округления: 95,996 фишки выплаты, чистый EV −4,004, RTP 95,996%. Выплата включает возвращаемую ставку. Чистый EV = выплата − ставка; RTP = суммарная выплата / все ставки.\n\n' +
  'Диапазон — нормальное приближение μ ± 1,96σ/√1000 для среднего одной стратегии, где σ рассчитана перебором всех исходов. Это не гарантия и не одновременный интервал для пяти строк. 1000 раундов не доказывают точность RTP, особенно на поздних шагах с высокой дисперсией. Точная проверка — математические unit-тесты.\n\n' +
  'Используются calculateSpinOutcome и OriginalsRandom из production-сборки, без базы данных и кошельков. Все случайные выборки записаны в draws.json; повтор запуска с --replay воспроизводит тот же результат и проверяет хеш математического модуля. Выборка не подбиралась под целевой RTP.\n\n' +
  'Запуск: npm --prefix backend run build, затем node backend/scripts/simulate-chest-ev.mjs. Повтор: node backend/scripts/simulate-chest-ev.mjs --replay.\n\n' +
  '## Ключи и потери по фактически открываемым шагам\n\n| Предмет | Попыток | Успехов | Потерь | Silver | Gold |\n|---|---:|---:|---:|---:|---:|\n' +
  summary
    .map(
      (s) =>
        '| ' +
        [s.stopAfterItem, s.attempts, s.successes, s.losses, s.silver, s.gold].join(' | ') +
        ' |',
    )
    .join('\n') +
  '\n\nЧастоту ключей нужно делить на успешные открытия, потери — на попытки. Первый предмет гарантирован.\n'

await mkdir(destination, { recursive: true })
await writeFile(new URL('draws.json', destination), JSON.stringify(metadata, null, 2))
await writeFile(new URL('summary.json', destination), JSON.stringify(summary, null, 2))
await writeFile(new URL('REPORT.md', destination), report)

const columns = [
  'round',
  'stake',
  'payoutAfter1',
  'payoutAfter2',
  'payoutAfter3',
  'payoutAfter4',
  'payoutAfter5',
]

await writeFile(
  new URL('rounds.csv', destination),
  columns.join(',') +
    '\n' +
    records.map((row) => columns.map((c) => row[c]).join(',')).join('\n') +
    '\n',
)
await writeFile(new URL('rounds.json', destination), JSON.stringify(records, null, 2))
console.log(table)
console.log('Report: ' + fileURLToPath(new URL('REPORT.md', destination)))
