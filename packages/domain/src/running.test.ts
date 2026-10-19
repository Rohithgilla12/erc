import { describe, expect, it } from 'vitest'
import { bandOf, categoriseDistance, type Metres } from './index'

const m = (metres: number) => metres as Metres

describe('categoriseDistance', () => {
  it.each([
    [4_899, 'other'],
    [4_900, '5k'],
    [5_000, '5k'],
    [5_100, '5k'],
    [5_101, 'other'],
    [9_800, '10k'],
    [10_200, '10k'],
    [21_097, 'half'],
    [21_201, 'other'],
    [42_195, 'marathon'],
    [42_301, 'other'],
    [25_000, 'other'],
    [45_000, 'ultra-50k'],
    [60_000, 'ultra-50k'],
    [60_001, 'other'],
    [80_467, 'ultra-50mi'],
    [100_000, 'ultra-100k'],
    [110_000, 'ultra-100k'],
    [160_934, 'ultra-100mi'],
    [175_001, 'other'],
  ] as const)('puts %i m in %s', (metres, category) => {
    expect(categoriseDistance(m(metres), false)).toBe(category)
  })

  it('puts any multi-day event in ultra-multiday, even at a standard distance', () => {
    expect(categoriseDistance(m(42_195), true)).toBe('ultra-multiday')
    expect(categoriseDistance(m(250_000), true)).toBe('ultra-multiday')
  })
})

describe('bandOf', () => {
  it.each([
    [1, 'under-10k'],
    [5_000, 'under-10k'],
    [9_799, 'under-10k'],
    [9_800, '10k-to-half'],
    [20_999, '10k-to-half'],
    [21_000, 'half-to-marathon'],
    [25_000, 'half-to-marathon'],
    [42_099, 'half-to-marathon'],
    [42_100, 'marathon-to-60k'],
    [60_000, 'marathon-to-60k'],
    [60_001, '60k-to-100k'],
    [110_000, '60k-to-100k'],
    [110_001, 'over-100k'],
    [1_000_000, 'over-100k'],
  ] as const)('puts %i m in %s', (metres, band) => {
    expect(bandOf(m(metres))).toBe(band)
  })
})
