import { describe, expect, it } from 'vitest'
import { formatDuration, formatKm, MAX_RUN_METRES, parseDuration, parseManualEntry, parseSourceRef, totalsOf, type LocalDate, type Metres, type Seconds } from './index'

const today = '2026-10-21' as LocalDate
const fields = (overrides: Record<string, unknown> = {}) => ({ date: '2026-10-20', distanceKm: '6.2', duration: '38:10', ...overrides })

describe('parseManualEntry', () => {
  it('reads a run, with the distance in metres and the time in seconds', () => {
    expect(parseManualEntry(fields(), today)).toEqual({ ok: true, value: { ref: null, on: '2026-10-20', distance: 6200, moving: 2290 } })
  })

  it('defaults the date to today and accepts today', () => {
    expect(parseManualEntry(fields({ date: '' }), today)).toMatchObject({ ok: true, value: { on: today } })
    expect(parseManualEntry(fields({ date: today }), today)).toMatchObject({ ok: true, value: { on: today } })
  })

  it('refuses a future date', () => {
    expect(parseManualEntry(fields({ date: '2026-10-22' }), today)).toEqual({ ok: false, error: { date: 'That date is still to come.' } })
  })

  it('refuses a date before 2000, including year 0000, and accepts 2000-01-01', () => {
    for (const date of ['1999-12-31', '0000-01-01', '0200-06-15']) {
      expect(parseManualEntry(fields({ date }), today)).toEqual({ ok: false, error: { date: 'That date is before 2000. Check the year.' } })
    }
    expect(parseManualEntry(fields({ date: '2000-01-01' }), today)).toMatchObject({ ok: true, value: { on: '2000-01-01' } })
  })

  it('needs a duration', () => {
    expect(parseManualEntry(fields({ duration: '' }), today)).toMatchObject({ ok: false, error: { duration: expect.stringContaining('minutes:seconds') } })
  })

  it('refuses a pace faster than 2:30 per km, and accepts 2:30 exactly', () => {
    expect(parseManualEntry(fields({ distanceKm: '10', duration: '24:59' }), today)).toEqual({
      ok: false,
      error: { duration: 'That pace is faster than 2:30 per km. Check the distance and time.' },
    })
    expect(parseManualEntry(fields({ distanceKm: '10', duration: '25:00' }), today)).toMatchObject({ ok: true })
  })

  it('refuses over 250 km, and accepts 250 km', () => {
    expect(parseManualEntry(fields({ distanceKm: '250.001', duration: '30:00:00' }), today)).toEqual({ ok: false, error: { distanceKm: 'That is over 250 km. Check the distance.' } })
    expect(parseManualEntry(fields({ distanceKm: '250', duration: '30:00:00' }), today)).toMatchObject({ ok: true, value: { distance: MAX_RUN_METRES } })
  })

  it('refuses a zero or unreadable distance', () => {
    for (const distanceKm of ['0', '0.0', 'ten', '-5']) {
      expect(parseManualEntry(fields({ distanceKm }), today)).toEqual({ ok: false, error: { distanceKm: 'Enter the distance in kilometres, such as 6.2.' } })
    }
  })

  it('accepts a decimal comma', () => {
    expect(parseManualEntry(fields({ distanceKm: '6,2' }), today)).toMatchObject({ ok: true, value: { distance: 6200 } })
  })

  it('carries a retry reference when the form sends one, and refuses a malformed one', () => {
    const ref = '3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c'
    expect(parseManualEntry(fields({ ref }), today)).toMatchObject({ ok: true, value: { ref } })
    expect(parseManualEntry(fields({ ref: 'not-a-uuid' }), today)).toEqual({ ok: false, error: { ref: 'The entry reference is not valid.' } })
  })

  it('reports every bad field at once', () => {
    expect(parseManualEntry({ date: 'yesterday', distanceKm: '', duration: '' }, today)).toMatchObject({
      ok: false,
      error: { date: 'Enter the date as YYYY-MM-DD.', distanceKm: expect.any(String), duration: expect.any(String) },
    })
  })
})

describe('parseDuration', () => {
  it.each([
    ['38:10', 2290],
    ['1:02:30', 3750],
    ['0:59', 59],
    ['12:00:00', 43200],
  ])('reads %s as %d seconds', (raw, seconds) => {
    expect(parseDuration(raw)).toEqual({ ok: true, value: seconds })
  })

  it.each(['38', '38:70', '1:2:3:4', '00:00', 'fast'])('refuses %s', (raw) => {
    expect(parseDuration(raw).ok).toBe(false)
  })
})

describe('totalsOf', () => {
  it('sums distance, time and count, and is zero for no runs', () => {
    const run = (distance: number, moving: number) => ({ distance: distance as Metres, moving: moving as Seconds })
    expect(totalsOf([run(6200, 2290), run(10000, 3000)])).toEqual({ distance: 16200, moving: 5290, runs: 2 })
    expect(totalsOf([])).toEqual({ distance: 0, moving: 0, runs: 0 })
  })
})

describe('formatting', () => {
  it('shows kilometres to one decimal and times as m:ss or h:mm:ss', () => {
    expect(formatKm(16200 as Metres)).toBe('16.2 km')
    expect(formatDuration(2290 as Seconds)).toBe('38:10')
    expect(formatDuration(3750 as Seconds)).toBe('1:02:30')
    expect(formatDuration(59 as Seconds)).toBe('0:59')
  })
})

describe('parseSourceRef', () => {
  it('lower-cases a UUID and refuses anything else', () => {
    expect(parseSourceRef('3F2A1C4E-9B7D-4E1A-8C2B-5D6E7F8A9B0C')).toEqual({ ok: true, value: '3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c' })
    expect(parseSourceRef('123')).toEqual({ ok: false, error: 'not_a_ref' })
  })
})
