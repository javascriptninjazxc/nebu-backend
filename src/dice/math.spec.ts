import { DiceRandom, multiplier, payout } from './math.js'

describe('Dice exact economy', () => {
  it('preserves known payouts and floors whole chips', () => {
    expect(payout('10000', 3, 1)).toBe('11000')
    expect(payout('10000', 3, 2)).toBe('12500')
    expect(payout('1100', 3, 1)).toBe('1200')
    expect(payout('10000', 3, 0)).toBe('0')
  })
  it('covers every mine count and possible opening without overflow or excessive RTP', () => {
    for (let m = 1; m <= 10; m++) {
      let probability = 1

      for (let k = 1; k <= 25 - m; k++) {
        probability *= (26 - m - k) / (26 - k)

        const factor = multiplier(m, k)

        expect(Number.isSafeInteger(factor)).toBe(true)
        expect((probability * factor) / 100).toBeLessThanOrEqual(0.97000000001)
        expect(BigInt(payout('10000000', m, k))).toBeLessThan(9223372036854775807n)
      }
    }
  })
  it('generates exactly m distinct mines within the 25 cells', () => {
    const rng = new DiceRandom()

    for (let m = 1; m <= 10; m++) {
      for (let i = 0; i < 50; i++) {
        const mask = rng.field(m)

        expect(mask.toString(2).replaceAll('0', '')).toHaveLength(m)
        expect(mask).toBeLessThan(1 << 25)
      }
    }
  })
})
