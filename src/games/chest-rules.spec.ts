import {
  CHEST_ODDS,
  CHEST_BONUS_ODDS,
  CHEST_MULTIPLIERS,
  chestPay,
  chestKey,
  chestBoostedPay,
  chestFraction,
  chestV3Value,
  chestV3Odds,
} from './chest-rules.js'

describe('greedy chest economy', () => {
  it('guarantees 60% first and preserves 96% expected return from the second stopping point', () => {
    let numerator = 1n

    let denominator = 1n

    CHEST_ODDS.forEach(([n, d], index) => {
      numerator *= BigInt(n)
      denominator *= BigInt(d)
      expect(numerator * BigInt(CHEST_MULTIPLIERS[index])).toBe(
        denominator * BigInt(index === 0 ? 60 : 96),
      )
    })
  })
  it('uses integer minor units at the stake boundaries', () => {
    expect(chestPay('1000', 1)).toBe('600')
    expect(chestPay('10000000', 7)).toBe('200000000')
    expect(() => chestPay('10000', 0)).toThrow()
  })
})

describe('version 2 key economy', () => {
  it('has mutually exclusive exact key probabilities', () => {
    const outcomes = Array.from({ length: 200 }, (_, i) => chestKey(BigInt(i)))

    expect(outcomes.filter((k) => k === 'gold')).toHaveLength(1)
    expect(outcomes.filter((k) => k === 'silver')).toHaveLength(10)
    expect(outcomes.filter((k) => k === null)).toHaveLength(189)
  })
  it('keeps each paid stopping point at 96% after stage one before rounding and gifts', () => {
    let n = 1n

    let d = 1n

    CHEST_BONUS_ODDS.forEach(([a, b], i) => {
      n *= BigInt(a) * 103n
      d *= BigInt(b) * 100n
      expect(n * BigInt(CHEST_MULTIPLIERS[i]) * 10n).toBe(d * BigInt(i === 0 ? 618 : 960))
    })
  })
  it('compounds keys without prematurely rounding fractional boosts', () => {
    expect(chestBoostedPay('10000', 1, 2, 1)).toBe('12000')
    expect(chestBoostedPay('10000', 3, 6, 2)).toBe('48000')
    expect(chestBoostedPay('1000', 7, 2187, 128)).toBe('341718')
    expect(chestBoostedPay('1000', 7, 729, 64)).toBe('227812')
    expect(chestBoostedPay('1000', 7, 1458, 64)).toBe('455625')
  })
})

describe('chest-3 fixed gold bonus', () => {
  it('adds 50 even to a small chest and carries the full amount forward', () => {
    const base = chestFraction(5000n)

    const gold = chestV3Value('10000', 2, base, 'gold')

    expect(gold).toEqual(chestFraction(25000n))
    expect(chestV3Value('10000', 3, gold)).toEqual(chestFraction(100000n, 3n))
  })
  it.each(['1000', '10000', '1234500', '10000000'])(
    'preserves 96%% at every fixed stopping point for stake %s',
    (stake) => {
      let states = [{ value: chestFraction(0n), probability: 1 }]

      for (let stage = 1; stage <= 7; stage++) {
        const next: typeof states = []

        for (const state of states) {
          const [n, d] = chestV3Odds(stake, stage - 1, state.value)

          for (const [key, p] of [
            [null, 0.945],
            ['silver', 0.05],
            ['gold', 0.005],
          ] as const) {
            next.push({
              value: chestV3Value(stake, stage, state.value, key),
              probability: ((state.probability * n) / d) * p,
            })
          }
        }

        states = next

        const ev = states.reduce(
          (sum, s) => sum + (s.probability * Number(s.value.n)) / Number(s.value.d) / Number(stake),
          0,
        )

        expect(ev).toBeCloseTo(stage === 1 ? 0.618 + 25 / Number(stake) : 0.96, 7)
      }
    },
  )
})
