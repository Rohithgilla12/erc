import { describe, expect, it } from 'vitest'
import {
  decideLink,
  endLink,
  parseCheckIn,
  parseWeekReview,
  summariseWeek,
  type AthleteCheckIn,
} from './coaching'

describe('coaching domain logic', () => {
  it('decides a requested link transition', () => {
    expect(decideLink('requested', 'accept')).toBe('active')
    expect(decideLink('requested', 'reject')).toBe('ended')
    expect(decideLink('active', 'accept')).toBeNull()
    expect(decideLink('ended', 'accept')).toBeNull()
  })

  it('ends an active link', () => {
    expect(endLink('active')).toBe('ended')
    expect(endLink('ended')).toBeNull()
    expect(endLink('requested')).toBeNull()
  })

  it('parses valid check-in inputs', () => {
    const parsed = parseCheckIn({
      feeling: 'tired',
      niggles: 'Right calf tightness',
      note: 'Felt sluggish after Thursday run',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.feeling).toBe('tired')
      expect(parsed.value.niggles).toBe('Right calf tightness')
      expect(parsed.value.note).toBe('Felt sluggish after Thursday run')
    }
  })

  it('handles optional check-in fields and trimmed text', () => {
    const parsed = parseCheckIn({
      feeling: 'great',
      niggles: '   ',
      note: '',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.feeling).toBe('great')
      expect(parsed.value.niggles).toBeNull()
      expect(parsed.value.note).toBeNull()
    }
  })

  it('rejects invalid check-in inputs', () => {
    const invalidFeeling = parseCheckIn({ feeling: 'fantastic' })
    expect(invalidFeeling.ok).toBe(false)
    if (!invalidFeeling.ok) {
      expect(invalidFeeling.error.feeling).toBeDefined()
    }

    const longNiggles = parseCheckIn({
      feeling: 'good',
      niggles: 'x'.repeat(281),
    })
    expect(longNiggles.ok).toBe(false)
    if (!longNiggles.ok) {
      expect(longNiggles.error.niggles).toBeDefined()
    }

    const longNote = parseCheckIn({
      feeling: 'good',
      note: 'x'.repeat(1001),
    })
    expect(longNote.ok).toBe(false)
    if (!longNote.ok) {
      expect(longNote.error.note).toBeDefined()
    }
  })

  it('parses valid week reviews from arrays or textareas', () => {
    const parsedFromArray = parseWeekReview({
      watch: ['Check calf', 'Hydrate on long run'],
      recommendations: ['Keep mid-week runs strictly Zone 2'],
      note: 'Solid week overall',
    })
    expect(parsedFromArray.ok).toBe(true)
    if (parsedFromArray.ok) {
      expect(parsedFromArray.value.watch).toEqual(['Check calf', 'Hydrate on long run'])
      expect(parsedFromArray.value.recommendations).toEqual(['Keep mid-week runs strictly Zone 2'])
      expect(parsedFromArray.value.note).toBe('Solid week overall')
    }

    const parsedFromText = parseWeekReview({
      watch: 'Check calf\n\nHydrate on long run\n',
      recos: 'Keep mid-week runs strictly Zone 2',
      note: '',
    })
    expect(parsedFromText.ok).toBe(true)
    if (parsedFromText.ok) {
      expect(parsedFromText.value.watch).toEqual(['Check calf', 'Hydrate on long run'])
      expect(parsedFromText.value.recommendations).toEqual(['Keep mid-week runs strictly Zone 2'])
      expect(parsedFromText.value.note).toBeNull()
    }
  })

  it('rejects invalid week reviews', () => {
    const tooManyWatch = parseWeekReview({
      watch: Array.from({ length: 11 }, (_, i) => `Watch item ${i + 1}`),
    })
    expect(tooManyWatch.ok).toBe(false)

    const longWatchItem = parseWeekReview({
      watch: ['a'.repeat(201)],
    })
    expect(longWatchItem.ok).toBe(false)

    const tooManyRecos = parseWeekReview({
      recommendations: Array.from({ length: 11 }, (_, i) => `Reco ${i + 1}`),
    })
    expect(tooManyRecos.ok).toBe(false)

    const longNote = parseWeekReview({
      note: 'x'.repeat(1001),
    })
    expect(longNote.ok).toBe(false)
  })

  it('summarises week with volume spike and niggle flags', () => {
    const thisWeek = [
      { metres: 12000, seconds: 3600, date: '2026-11-03' },
      { metres: 15000, seconds: 4500, date: '2026-11-05' },
    ]
    const lastWeek = [
      { metres: 20000, seconds: 6000, date: '2026-10-27' },
    ]
    const checkIn: AthleteCheckIn = {
      feeling: 'tired',
      niggles: 'Left shin splints',
      note: 'Tough week',
      submittedAt: '2026-11-08T18:00:00Z',
    }
    const summary = summariseWeek(thisWeek, lastWeek, checkIn)
    expect(summary.totalMetres).toBe(27000)
    expect(summary.volumeChangePct).toBe(35)
    expect(summary.flags).toContain('VOLUME_SPIKE')
    expect(summary.flags).toContain('NIGGLE_REPORTED')
    expect(summary.flags).toContain('ELEVATED_FATIGUE')
    expect(summary.suggestedWatch.length).toBeGreaterThan(0)
    expect(summary.suggestedWatch).toContain('Monitor adaptation after a 35% volume increase; do not increase mileage next week.')
    expect(summary.suggestedWatch).toContain('Check Left shin splints on warm-up; abort if pain exceeds 3/10.')
    expect(summary.suggestedRecos).toContain('Prioritize 8+ hrs sleep and keep mid-week easy runs strictly Zone 1/2.')
  })

  it('summarises week with missed logs when no runs logged', () => {
    const summary = summariseWeek([], [{ metres: 15000, seconds: 4500, date: '2026-10-27' }])
    expect(summary.runCount).toBe(0)
    expect(summary.totalMetres).toBe(0)
    expect(summary.totalSeconds).toBe(0)
    expect(summary.longestRunMetres).toBe(0)
    expect(summary.volumeChangePct).toBe(-100)
    expect(summary.flags).toContain('MISSED_LOGS')
    expect(summary.suggestedWatch).toContain('No runs logged this week.')
  })

  it('flags no rest days when running 7 distinct days in a week', () => {
    const runs = [
      { metres: 5000, seconds: 1500, date: '2026-11-02' },
      { metres: 5000, seconds: 1500, date: '2026-11-03' },
      { metres: 5000, seconds: 1500, date: '2026-11-04' },
      { metres: 5000, seconds: 1500, date: '2026-11-05' },
      { metres: 5000, seconds: 1500, date: '2026-11-06' },
      { metres: 5000, seconds: 1500, date: '2026-11-07' },
      { metres: 5000, seconds: 1500, date: '2026-11-08' },
    ]
    const summary = summariseWeek(runs)
    expect(summary.flags).toContain('NO_REST_DAY')
    expect(summary.suggestedWatch).toContain('Ran all 7 days this week without a rest day.')
    expect(summary.suggestedRecos).toContain('Schedule at least one complete rest day next week.')
  })

  it('flags long run heavy when single run exceeds 40% volume', () => {
    const runs = [
      { metres: 5000, seconds: 1500, date: '2026-11-03' },
      { metres: 5000, seconds: 1500, date: '2026-11-05' },
      { metres: 15000, seconds: 4500, date: '2026-11-08' }, // 15km of 25km = 60%
    ]
    const summary = summariseWeek(runs)
    expect(summary.flags).toContain('LONG_RUN_HEAVY')
    expect(summary.suggestedWatch).toContain('Long run exceeded 40% of weekly volume.')
  })

  it('handles null/absent lastWeek and checkIn gracefully', () => {
    const runs = [{ metres: 10000, seconds: 3000, date: '2026-11-04' }]
    const summary = summariseWeek(runs, null, null)
    expect(summary.totalMetres).toBe(10000)
    expect(summary.previousWeekMetres).toBeNull()
    expect(summary.volumeChangePct).toBeNull()
    expect(summary.flags).not.toContain('VOLUME_SPIKE')
    expect(summary.flags).not.toContain('ELEVATED_FATIGUE')
    expect(summary.flags).not.toContain('NIGGLE_REPORTED')
  })
})
