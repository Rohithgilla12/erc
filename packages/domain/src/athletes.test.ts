import { describe, expect, it } from 'vitest'
import {
  deriveAchievements,
  type DistanceCategory,
  type Email,
  type Id,
  type Instant,
  type LocalDate,
  type Metres,
  type Moderation,
  type RaceResult,
  type Seconds,
  type StaffId,
} from './index'

const at = '2026-10-01T00:00:00.000Z' as Instant
const approved: Moderation = { state: 'approved', by: 1 as StaffId, at }
const submitted: Moderation = { state: 'submitted', submitter: { name: 'Ravi', email: 'ravi@example.com' as Email }, at }
const rejected: Moderation = { state: 'rejected', by: 1 as StaffId, at, reason: 'no evidence' }

const result = (
  id: number,
  category: DistanceCategory,
  time: number,
  options: { date?: string; official?: boolean; moderation?: Moderation; eventName?: string } = {},
): RaceResult => ({
  id: id as Id<'results'>,
  athlete: 1 as Id<'athletes'>,
  race: null,
  eventName: options.eventName ?? `Event ${id}`,
  date: (options.date ?? '2026-01-01') as LocalDate,
  distance: 0 as Metres,
  category,
  time: time as Seconds,
  provenance: options.official === false ? { kind: 'self_reported', evidenceUrl: null } : { kind: 'official', timingUrl: null },
  moderation: options.moderation ?? approved,
})

describe('deriveAchievements bests', () => {
  it('keeps the lowest time per category', () => {
    const { bests } = deriveAchievements([result(1, '10k', 3_000), result(2, '10k', 2_900), result(3, '10k', 3_100), result(4, '5k', 1_400)])
    expect(bests).toEqual({
      '10k': { time: 2_900, result: 2, verified: true },
      '5k': { time: 1_400, result: 4, verified: true },
    })
  })

  it('ignores submitted and rejected results, even when they are faster', () => {
    const { bests, ultraFinishes } = deriveAchievements([
      result(1, '10k', 3_000),
      result(2, '10k', 2_000, { moderation: submitted }),
      result(3, '10k', 2_100, { moderation: rejected }),
      result(4, 'ultra-50k', 20_000, { moderation: submitted }),
    ])
    expect(bests).toEqual({ '10k': { time: 3_000, result: 1, verified: true } })
    expect(ultraFinishes).toEqual([])
  })

  it('marks a self-reported best as unverified', () => {
    const { bests } = deriveAchievements([result(1, 'half', 6_000, { official: false }), result(2, 'half', 6_100)])
    expect(bests).toEqual({ half: { time: 6_000, result: 1, verified: false } })
  })

  it('gives a tied time to the official result whichever order they arrive in', () => {
    const selfReported = result(1, 'marathon', 12_000, { official: false })
    const official = result(2, 'marathon', 12_000)
    const expected = { marathon: { time: 12_000, result: 2, verified: true } }
    expect(deriveAchievements([selfReported, official]).bests).toEqual(expected)
    expect(deriveAchievements([official, selfReported]).bests).toEqual(expected)
  })

  it('keeps no best for distances outside the PB slots', () => {
    const { bests } = deriveAchievements([result(1, 'other', 9_000), result(2, 'ultra-multiday', 200_000)])
    expect(bests).toEqual({})
  })

  it('returns nothing for no results', () => {
    expect(deriveAchievements([])).toEqual({ bests: {}, ultraFinishes: [] })
  })
})

describe('deriveAchievements ultra finishes', () => {
  it('lists approved ultra results newest first, including multi-day, and nothing shorter', () => {
    const { ultraFinishes } = deriveAchievements([
      result(1, 'ultra-50k', 20_000, { date: '2025-03-01', eventName: 'Nilgiris 50K' }),
      result(2, 'marathon', 12_000, { date: '2026-06-01' }),
      result(3, 'ultra-multiday', 300_000, { date: '2026-02-10', eventName: 'Himalayan Stage Race' }),
      result(4, 'ultra-100k', 50_000, { date: '2025-11-15', eventName: 'Malnad 100K', official: false }),
      result(5, 'other', 9_000, { date: '2026-07-01' }),
    ])
    expect(ultraFinishes).toEqual([
      { category: 'ultra-multiday', eventName: 'Himalayan Stage Race', date: '2026-02-10' },
      { category: 'ultra-100k', eventName: 'Malnad 100K', date: '2025-11-15' },
      { category: 'ultra-50k', eventName: 'Nilgiris 50K', date: '2025-03-01' },
    ])
  })
})
