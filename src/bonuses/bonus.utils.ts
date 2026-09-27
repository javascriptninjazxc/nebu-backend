import { createHash, randomInt } from 'node:crypto'
import { BONUS_PRIZES } from './bonus.constants.js'

export const guestDigest = (token: string) => createHash('sha256').update(token).digest('hex')

export function choosePrize(value = randomInt(100)) {
  for (const [i, p] of BONUS_PRIZES.entries()) {
    value -= p.weight

    if (value < 0) {
      return i
    }
  }

  throw new Error('Invalid prize roll')
}
