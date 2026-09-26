import { cachePay, forestPay, FOREST_SECTORS, OriginalsRandom, periodWindow } from './random.js'

describe('originals exact economy and schedules', () => {
  it('preserves all three cache multipliers, including fractional-chip payouts', () => {
    expect(cachePay('10000', 1)).toBe('19200')
    expect(cachePay('10000', 2)).toBe('48000')
    expect(cachePay('10000', 3)).toBe('192000')
    expect(cachePay('1100', 1)).toBe('2112')
  })
  it('preserves forest RTP before rounding and rounds each outcome down to a whole chip', () => {
    expect(FOREST_SECTORS.filter((s) => s === 'coin')).toHaveLength(5)
    expect(FOREST_SECTORS.filter((s) => s === 'key')).toHaveLength(2)
    expect((5 / 16) * 1.4 + (4 / 16) * 0.55 + (2 / 16) * (9 / 3 + (0.25 * 2) / 3)).toBeCloseTo(
      0.970833333,
      8,
    )
    expect(forestPay('1100', 14n, 10n)).toBe('1500')
    expect(forestPay('1100', 1n, 2n)).toBe('500')
  })
  it('uses Moscow midnight and half-open hourly periods', () => {
    const before = new Date('2026-09-18T20:59:59.999Z')

    const after = new Date('2026-09-18T21:00:00.000Z')

    expect(periodWindow('mega', before).end.toISOString()).toBe('2026-09-18T21:00:00.000Z')
    expect(periodWindow('mega', after).end.toISOString()).toBe('2026-09-19T21:00:00.000Z')
    expect(periodWindow('mini', after).start.toISOString()).toBe(after.toISOString())
  })
  it('keeps draws within exact bigint weights and decks at three unique treasures', () => {
    const rng = new OriginalsRandom()

    for (let i = 0; i < 100; i++) {
      expect(rng.deck().toString(2).replaceAll('0', '')).toHaveLength(3)

      const n = rng.weighted(9007199254740993000n)

      expect(n).toBeGreaterThanOrEqual(0n)
      expect(n).toBeLessThan(9007199254740993000n)
    }

    expect(rng.weighted(1n)).toBe(0n)
    expect(() => rng.weighted(0n)).toThrow()
  })
})
