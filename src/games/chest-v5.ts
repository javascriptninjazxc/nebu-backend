import { chestFraction, type ChestFraction, type ChestKey } from './chest-rules.js'

export const RTP_BASE = 0.932

export const CHANCE_SILVER = 0.05

export const CHANCE_GOLD = 0.005

export const RTP_TOTAL = 0.95996

export const CHEST_V5_SURVIVAL = [100, 95, 85, 60, 30, 10, 5] as const

export type ChestRandom = (exclusiveUpperBound: bigint) => bigint

export function checkForKey(currentChestValue: ChestFraction, random: ChestRandom) {
  if (currentChestValue.n < 0n || currentChestValue.d <= 0n) {
    throw new Error('Invalid chest')
  }

  const roll = random(200n)

  if (roll < 0n || roll >= 200n) {
    throw new Error('Invalid key roll')
  }

  return roll === 0n
    ? { type: 'gold' as const, multiplier: 2 }
    : roll < 11n
      ? { type: 'silver' as const, multiplier: 1.5 }
      : { type: 'none' as const, multiplier: 1 }
}

export function isChestClosed(riskLevel: number, random: ChestRandom): boolean {
  if (!Number.isInteger(riskLevel) || riskLevel < 1 || riskLevel > 6) {
    throw new Error('Invalid risk level')
  }

  const roll = random(100n)

  if (roll < 0n || roll >= 100n) {
    throw new Error('Invalid risk roll')
  }

  return roll >= BigInt(CHEST_V5_SURVIVAL[riskLevel]!)
}

export function chestV5Value(
  stake: string,
  nextStage: number,
  previous: ChestFraction,
  key: ChestKey = null,
): ChestFraction {
  if (!Number.isInteger(nextStage) || nextStage < 1 || nextStage > 7) {
    throw new Error('Invalid chest stage')
  }

  // First opening: .932 * E[key] = .932 * 1.03 = .95996.
  // Each continuation: p * growth * E[key] = 1.
  // Keys apply to ALL accumulated contents, never just the original stake.
  let value =
    nextStage === 1
      ? chestFraction(BigInt(stake) * 932n, 1000n)
      : chestFraction(
          previous.n * 10000n,
          previous.d * BigInt(CHEST_V5_SURVIVAL[nextStage - 1]!) * 103n,
        )

  if (key === 'silver') {
    value = chestFraction(value.n * 3n, value.d * 2n)
  }

  if (key === 'gold') {
    value = chestFraction(value.n * 2n, value.d)
  }

  return value
}

export function calculateSpinOutcome(
  stake: string,
  currentChestValue: ChestFraction,
  stage: number,
  random: ChestRandom,
) {
  if (BigInt(stake) < 1000n || BigInt(stake) > 10000000n || BigInt(stake) % 100n !== 0n) {
    throw new Error('Invalid stake')
  }

  if (!Number.isInteger(stage) || stage < 0 || stage >= 7) {
    throw new Error('No further opening')
  }

  if (stage > 0 && currentChestValue.n <= 0n) {
    throw new Error('Empty active chest')
  }

  if (stage > 0 && isChestClosed(stage, random)) {
    return { closed: true as const, value: chestFraction(0n), base: chestFraction(0n), key: null }
  }

  const base = chestV5Value(stake, stage + 1, currentChestValue)

  const key = checkForKey(base, random)

  return {
    closed: false as const,
    base,
    value: chestV5Value(stake, stage + 1, currentChestValue, key.type === 'none' ? null : key.type),
    key: key.type === 'none' ? null : key.type,
  }
}
