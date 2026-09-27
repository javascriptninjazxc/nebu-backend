import { Injectable } from '@nestjs/common'
import { randomBytes, randomInt } from 'node:crypto'

export const FOREST_SECTORS = [
  'coin',
  'crystal',
  'bankrupt',
  'key',
  'coin',
  'bankrupt',
  'crystal',
  'coin',
  'bankrupt',
  'crystal',
  'coin',
  'key',
  'bankrupt',
  'coin',
  'crystal',
  'bankrupt',
] as const

@Injectable()
export class OriginalsRandom {
  outer() {
    return randomInt(16)
  }

  inner() {
    return randomInt(3)
  }

  risk() {
    return randomInt(2) === 0
  }

  deck() {
    const cards = [0, 1, 2, 3, 4, 5]

    for (let i = 5; i > 0; i--) {
      const j = randomInt(i + 1)

      ;[cards[i], cards[j]] = [cards[j], cards[i]]
    }

    return cards.slice(0, 3).reduce((mask, i) => mask | (1 << i), 0)
  }

  weighted(total: bigint) {
    if (total <= 0n) {
      throw new Error('Empty draw')
    }

    const bytes = Math.ceil(total.toString(2).length / 8)

    const range = 1n << BigInt(bytes * 8)

    const limit = range - (range % total)

    let n: bigint

    do {
      n = BigInt('0x' + randomBytes(bytes).toString('hex'))
    } while (n >= limit)

    return n % total
  }
}

export function forestPay(stake: string, numerator: bigint, denominator = 1n) {
  return (((BigInt(stake) * numerator) / (denominator * 100n)) * 100n).toString()
}

export function cachePay(stake: string, found: number) {
  return found ? ((BigInt(stake) * BigInt([192, 480, 1920][found - 1])) / 100n).toString() : '0'
}

export function periodWindow(pool: 'mini' | 'mega', now: Date) {
  const duration = pool === 'mini' ? 3600000 : 86400000

  const offset = pool === 'mega' ? 10800000 : 0

  const start = Math.floor((now.getTime() + offset) / duration) * duration - offset

  return { start: new Date(start), end: new Date(start + duration) }
}
