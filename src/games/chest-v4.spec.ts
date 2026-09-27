import { chestFraction } from './chest-rules.js'
import {
  calculateSpinOutcome,
  checkForKey,
  CHEST_V4_SURVIVAL,
  chestV4Value,
  isChestClosed,
} from './chest-v4.js'

describe('chest-4 exact math', () => {
  it('has exclusive 10 silver and 1 gold outcomes out of 200', () => {
    const keys = Array.from(
      { length: 200 },
      (_, i) => checkForKey(chestFraction(100n), () => BigInt(i)).type,
    )

    expect(keys.filter((k) => k === 'silver')).toHaveLength(10)
    expect(keys.filter((k) => k === 'gold')).toHaveLength(1)
  })
  it.each([1, 2, 3, 4])('implements exact loss probability at risk %s', (risk) => {
    const closed = Array.from({ length: 100 }, (_, i) =>
      isChestClosed(risk, () => BigInt(i)),
    ).filter(Boolean)

    expect(closed).toHaveLength(100 - CHEST_V4_SURVIVAL[risk]!)
  })
  it('preserves expectation at each continuation for every key history', () => {
    let states = [chestFraction(9320n)]

    for (let stage = 2; stage <= 5; stage++) {
      const next = []

      for (const current of states) {
        const base = chestV4Value('10000', stage, current)

        // survival/100 * base * 103/100 == current, exactly, no floating point.
        expect(base.n * BigInt(CHEST_V4_SURVIVAL[stage - 1]!) * 103n * current.d).toBe(
          current.n * base.d * 10000n,
        )

        for (const key of [null, 'silver', 'gold'] as const) {
          next.push(chestV4Value('10000', stage, current, key))
        }
      }

      states = next
    }

    expect(932n * 103n).toBe(95996n)
  })
  it('gold doubles contents without +50, and loss draws no key', () => {
    const draws: bigint[] = []

    const first = calculateSpinOutcome('10000', chestFraction(0n), 0, (n) => {
      draws.push(n)

      return 0n
    })

    expect(first.value).toEqual(chestFraction(18640n))
    expect(draws).toEqual([200n])
    draws.length = 0

    const loss = calculateSpinOutcome('10000', first.value, 1, (n) => {
      draws.push(n)

      return 99n
    })

    expect(loss.closed).toBe(true)
    expect(loss.value.n).toBe(0n)
    expect(draws).toEqual([100n])
  })
  it('rejects attempts beyond four continuations', () => {
    expect(() => calculateSpinOutcome('10000', chestFraction(1n), 5, () => 0n)).toThrow()
  })
})
