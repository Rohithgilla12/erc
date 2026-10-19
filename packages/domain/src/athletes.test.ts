import { describe, expect, it } from 'vitest'
import {
  athleteRecordOf,
  categoriseResult,
  deriveAchievements,
  formatFinishTime,
  headlineBests,
  parseFinishTime,
  type Athlete,
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
  options: { date?: string; official?: boolean; moderation?: Moderation; eventName?: string; athlete?: number } = {},
): RaceResult => ({
  id: id as Id<'results'>,
  athlete: (options.athlete ?? 1) as Id<'athletes'>,
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

const visibility = (results: Athlete['visibility']['results']): Pick<Athlete, 'id' | 'visibility'> => ({
  id: 1 as Id<'athletes'>,
  visibility: { profile: 'public', results },
})

describe('athleteRecordOf', () => {
  it('shows nothing when the athlete keeps results hidden, however many approved results exist', () => {
    expect(athleteRecordOf(visibility('hidden'), [result(1, '10k', 3_000), result(2, 'ultra-50k', 20_000)])).toEqual({
      visibility: 'hidden',
    })
  })

  it('lists only approved results of this athlete, newest first, and derives bests from exactly those', () => {
    const results = [
      result(1, '10k', 3_000, { date: '2025-05-01' }),
      result(2, '10k', 2_500, { date: '2026-02-01', moderation: submitted }),
      result(3, '5k', 1_300, { date: '2026-03-01', athlete: 2 }),
      result(4, 'half', 6_500, { date: '2026-01-10', official: false }),
      result(5, '10k', 2_950, { date: '2026-01-10', moderation: rejected }),
    ]
    const record = athleteRecordOf(visibility('public'), results)
    if (record.visibility !== 'public') throw new Error('expected a public record')
    expect(record.results.map((r) => r.id)).toEqual([4, 1])
    expect(record.achievements).toEqual(deriveAchievements([results[0]!, results[3]!]))
    expect(record.achievements.bests).toEqual({
      '10k': { time: 3_000, result: 1, verified: true },
      half: { time: 6_500, result: 4, verified: false },
    })
  })
})

describe('headlineBests', () => {
  it('keeps the longest slots, shortest first, with their verification', () => {
    const { bests, ultraFinishes } = deriveAchievements([
      result(1, '5k', 1_200),
      result(2, '10k', 2_600),
      result(3, 'half', 6_000, { official: false }),
      result(4, 'ultra-50k', 18_000),
    ])
    expect(headlineBests({ bests, ultraFinishes })).toEqual([
      { category: '10k', label: '10K', time: 2_600, verified: true },
      { category: 'half', label: 'Half marathon', time: 6_000, verified: false },
      { category: 'ultra-50k', label: '50K', time: 18_000, verified: true },
    ])
  })

  it('is empty without bests', () => {
    expect(headlineBests({ bests: {}, ultraFinishes: [] })).toEqual([])
  })
})

describe('parseFinishTime', () => {
  it.each([
    ['0:19:45', 1_185],
    ['3:05:09', 11_109],
    ['27:03:10', 97_390],
    ['100:00:00', 360_000],
    [' 1:00:00 ', 3_600],
  ])('reads %s as %i seconds', (raw, seconds) => {
    expect(parseFinishTime(raw)).toEqual({ ok: true, value: seconds })
  })

  it.each(['19:45', '1:30', '0:60:00', '0:00:60', '0:00:00', '1:2:03', '1:02:3', '1h02m03s', '-1:00:00', '1:00:00.5', ''])(
    'refuses %j',
    (raw) => {
      expect(parseFinishTime(raw)).toEqual({ ok: false, error: 'not_a_finish_time' })
    },
  )

  it('round-trips through formatFinishTime', () => {
    for (const raw of ['0:19:45', '3:05:09', '27:03:10', '0:00:01']) {
      const parsed = parseFinishTime(raw)
      if (!parsed.ok) throw new Error(`did not parse ${raw}`)
      expect(formatFinishTime(parsed.value)).toBe(raw)
    }
  })
})

describe('categoriseResult', () => {
  it.each([
    [10_000, 2, '10k'],
    [42_195, 3, 'marathon'],
    [42_195, 1, 'marathon'],
    [120_000, 3, 'ultra-multiday'],
    [50_000, 2, 'ultra-multiday'],
    [50_000, 1, 'ultra-50k'],
    [161_000, 1, 'ultra-100mi'],
  ] as const)('%i m at a %i-day race is %s', (metres, days, category) => {
    expect(categoriseResult(metres as Metres, days)).toBe(category)
  })
})
