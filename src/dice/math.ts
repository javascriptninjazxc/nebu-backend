import { Injectable } from '@nestjs/common'
import { randomInt } from 'node:crypto'

export const RULES_VERSION = 'dice-1'

export function multiplier(mines: number, opened: number): number {
  if (
    !Number.isInteger(mines) ||
    mines < 1 ||
    mines > 10 ||
    !Number.isInteger(opened) ||
    opened < 0 ||
    opened > 25 - mines
  ) {
    throw new Error('Invalid math inputs')
  }

  if (!opened) {
    return 100
  }

  let numerator = 97n

  let denominator = 1n

  for (let i = 0; i < opened; i++) {
    numerator *= BigInt(25 - i)
    denominator *= BigInt(25 - mines - i)
  }

  return Number(numerator / denominator)
}

export function payout(stake: string, mines: number, opened: number): string {
  return opened
    ? (((BigInt(stake) * BigInt(multiplier(mines, opened))) / 10000n) * 100n).toString()
    : '0'
}

@Injectable()
export class DiceRandom {
  field(mines: number): number {
    const cells = Array.from({ length: 25 }, (_, i) => i)

    for (let i = 24; i > 0; i--) {
      const j = randomInt(i + 1)

      ;[cells[i], cells[j]] = [cells[j], cells[i]]
    }

    return cells.slice(0, mines).reduce((mask, cell) => mask | (1 << cell), 0)
  }
}
