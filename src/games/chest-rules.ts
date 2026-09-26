// Stage 1 is a guaranteed 60% return. From stage 2 each stopping point returns 96% in expectation.
export const CHEST_MULTIPLIERS = [60, 120, 160, 240, 400, 800, 2000] as const

export const CHEST_ODDS = [
  [1, 1],
  [4, 5],
  [3, 4],
  [2, 3],
  [3, 5],
  [1, 2],
  [2, 5],
] as const

export const CHEST_ITEMS = ['acorn', 'dew', 'flower'] as const

export function chestPay(stake: string, stage: number) {
  if (!Number.isInteger(stage) || stage < 1 || stage > CHEST_MULTIPLIERS.length) {
    throw new Error('Invalid chest stage')
  }

  return ((BigInt(stake) * BigInt(CHEST_MULTIPLIERS[stage - 1]!)) / 100n).toString()
}

export type ChestKey = 'silver' | 'gold' | null

export function chestKey(roll: bigint): ChestKey {
  if (roll < 0n || roll >= 200n) {
    throw new Error('Invalid key draw')
  }

  return roll === 0n ? 'gold' : roll < 11n ? 'silver' : null
}

export function chestBoostedPay(stake: string, stage: number, numerator = 1, denominator = 1) {
  if (
    !Number.isInteger(stage) ||
    stage < 1 ||
    stage > 7 ||
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 1 ||
    denominator < 1
  ) {
    throw new Error('Invalid chest boost')
  }

  return (
    (BigInt(stake) * BigInt(CHEST_MULTIPLIERS[stage - 1]!) * BigInt(numerator)) /
    (100n * BigInt(denominator))
  ).toString()
}

// E[key multiplier] = 1.03. First return is .618; stage 2 absorbs both key draws.
export const CHEST_BONUS_ODDS = [
  [1, 1],
  [8000, 10609],
  [75, 103],
  [200, 309],
  [60, 103],
  [50, 103],
  [40, 103],
] as const

// chest-3: +50 chips are part of the chest and grow with its contents.
export const CHEST_GOLD_FIXED_MINOR = 5000n

export type ChestFraction = { n: bigint; d: bigint }

export function chestFraction(n: bigint, d = 1n): ChestFraction {
  if (n < 0n || d <= 0n) {
    throw new Error('Invalid chest value')
  }

  let a = n

  let b = d

  while (b) {
    const r = a % b

    a = b
    b = r
  }

  return { n: n / (a || 1n), d: d / (a || 1n) }
}

export function chestV3Value(
  stake: string,
  nextStage: number,
  previous: ChestFraction,
  key: ChestKey = null,
): ChestFraction {
  if (!Number.isInteger(nextStage) || nextStage < 1 || nextStage > 7) {
    throw new Error('Invalid chest stage')
  }

  let value =
    nextStage === 1
      ? chestFraction(BigInt(stake) * 60n, 100n)
      : chestFraction(
          previous.n * BigInt(CHEST_MULTIPLIERS[nextStage - 1]!),
          previous.d * BigInt(CHEST_MULTIPLIERS[nextStage - 2]!),
        )

  if (key === 'silver') {
    value = chestFraction(value.n * 3n, value.d * 2n)
  }

  if (key === 'gold') {
    value = chestFraction(value.n * 2n + CHEST_GOLD_FIXED_MINOR * value.d, value.d)
  }

  return value
}

export function chestV3Odds(
  stake: string,
  stage: number,
  current: ChestFraction,
): readonly [number, number] {
  if (stage === 0) {
    return [1, 1]
  }

  if (stage >= 7) {
    return [0, 1]
  }

  const next = chestV3Value(stake, stage + 1, current)

  // Expected successful opening: 1.03 * next + .005 * 5000 minor.
  const en = next.n * 103n + 25n * next.d * 100n

  const ed = next.d * 100n

  let n = current.n * ed

  let d = current.d * en

  // First guaranteed opening has expectation .618*stake + 25 minor.
  if (stage === 1) {
    n *= 960n * BigInt(stake)
    d *= 618n * BigInt(stake) + 25000n
  }

  const scale = 1000000000n

  const chance = (n * scale) / d

  if (chance < 0n || chance > scale) {
    throw new Error('Invalid chest probability')
  }

  return [Number(chance), Number(scale)] // floor: never exceeds the target EV
}
