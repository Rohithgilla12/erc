import { describe, expect, it } from 'vitest'

import type { MemberId } from './members'
import { overBudget, parseRateLimits, parseStravaActivityId, parseStravaDetail, parseStravaStreams, parseStravaSummary } from './strava'

const member = 7 as MemberId

const summary = {
  id: 12345678901,
  name: 'Morning tempo',
  type: 'Run',
  sport_type: 'Run',
  distance: 10012.4,
  moving_time: 2900,
  elapsed_time: 3010,
  start_date: '2026-11-20T00:45:00Z',
  start_date_local: '2026-11-20T06:15:00Z',
  has_heartrate: true,
  average_heartrate: 151.6,
  max_heartrate: 178,
  average_cadence: 86.2,
  total_elevation_gain: 42.3,
  elev_high: 921.4,
  elev_low: 880.1,
  average_speed: 3.45,
  max_speed: 5.2,
  workout_type: 3,
}

const detail = {
  ...summary,
  calories: 702.4,
  device_name: 'Garmin Forerunner 265',
  splits_metric: [
    { split: 1, distance: 1000.2, moving_time: 291, elapsed_time: 300, average_heartrate: 140.2, elevation_difference: 3.1, pace_zone: 2 },
    { split: 2, distance: 1001.1, moving_time: 288, elapsed_time: 288, average_heartrate: 152.9, elevation_difference: -1.4, pace_zone: 3 },
    { split: 2, distance: 999, moving_time: 280, elapsed_time: 280 },
    { split: 3, distance: 'far', moving_time: 280, elapsed_time: 280 },
  ],
  laps: [{ lap_index: 1, name: 'Lap 1', distance: 10012.4, moving_time: 2900, elapsed_time: 3010, average_speed: 3.45, max_speed: 5.2, average_heartrate: 151.6, max_heartrate: 178, average_cadence: 86.2, total_elevation_gain: 42.3 }],
  best_efforts: [
    { name: '1k', distance: 1000, moving_time: 270, elapsed_time: 270, pr_rank: 2 },
    { name: '5k', distance: 5000, moving_time: 1420, elapsed_time: 1430, pr_rank: null },
    { distance: 10000, moving_time: 2890, elapsed_time: 2890 },
  ],
}

describe('parseStravaSummary', () => {
  it('reads whole-run metrics and doubles per-leg cadence', () => {
    const parsed = parseStravaSummary(summary, member)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.id).toBe(12345678901)
    expect(parsed.value.activity).toMatchObject({ member, source: 'strava', ref: 'strava:12345678901', on: '2026-11-20', distance: 10012, moving: 2900, note: 'Morning tempo' })
    expect(parsed.value.metrics).toEqual({
      startAt: '2026-11-20T00:45:00.000Z',
      elapsed: 3010,
      heartRate: { average: 152, max: 178 },
      cadence: 172,
      elevationGain: 42.3,
      elevationHigh: 921.4,
      elevationLow: 880.1,
      averageSpeed: 3.45,
      maxSpeed: 5.2,
      workoutType: 'workout',
    })
  })

  it('leaves heart rate and cadence null for a run recorded without them', () => {
    const { average_heartrate: _a, max_heartrate: _m, average_cadence: _c, ...bare } = summary
    const parsed = parseStravaSummary({ ...bare, has_heartrate: false }, member)
    expect(parsed.ok && parsed.value.metrics.heartRate).toBeNull()
    expect(parsed.ok && parsed.value.metrics.cadence).toBeNull()
  })

  it('drops heart rate when only one of average and maximum is present', () => {
    const { max_heartrate: _m, ...partial } = summary
    const parsed = parseStravaSummary(partial, member)
    expect(parsed.ok && parsed.value.metrics.heartRate).toBeNull()
  })

  it('treats implausible values as unmeasured', () => {
    const parsed = parseStravaSummary({ ...summary, average_heartrate: 400, average_cadence: -3, max_speed: 'fast', workout_type: 11 }, member)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.metrics).toMatchObject({ heartRate: null, cadence: null, maxSpeed: null, workoutType: null })
  })

  it('never reports elapsed time shorter than moving time', () => {
    const parsed = parseStravaSummary({ ...summary, elapsed_time: 100 }, member)
    expect(parsed.ok && parsed.value.metrics.elapsed).toBe(2900)
  })

  it('refuses input that is not a run activity', () => {
    expect(parseStravaSummary(null, member)).toEqual({ ok: false, error: 'not_an_object' })
    expect(parseStravaSummary([summary], member)).toEqual({ ok: false, error: 'not_an_object' })
    expect(parseStravaSummary({ ...summary, id: -4 }, member)).toEqual({ ok: false, error: 'not_an_id' })
    expect(parseStravaSummary({ ...summary, id: '12a' }, member)).toEqual({ ok: false, error: 'not_an_id' })
    expect(parseStravaSummary({ ...summary, sport_type: 'Ride', type: 'Ride' }, member)).toEqual({ ok: false, error: 'not_a_run' })
    expect(parseStravaSummary({ ...summary, start_date: 'yesterday' }, member)).toEqual({ ok: false, error: 'invalid_date' })
    expect(parseStravaSummary({ ...summary, distance: '10k' }, member)).toEqual({ ok: false, error: 'invalid_distance' })
    expect(parseStravaSummary({ ...summary, moving_time: null }, member)).toEqual({ ok: false, error: 'invalid_pace' })
  })
})

describe('parseStravaDetail', () => {
  it('adds calories, device, splits, laps and best efforts', () => {
    const parsed = parseStravaDetail(detail, member)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const { calories, deviceName, splits, laps, bestEfforts } = parsed.value.detail
    expect(calories).toBe(702)
    expect(deviceName).toBe('Garmin Forerunner 265')
    expect(splits).toEqual([
      { index: 1, distance: 1000.2, moving: 291, elapsed: 300, heartRate: 140, elevationDiff: 3.1, paceZone: 2 },
      { index: 2, distance: 1001.1, moving: 288, elapsed: 288, heartRate: 153, elevationDiff: -1.4, paceZone: 3 },
    ])
    expect(laps).toEqual([
      { index: 1, name: 'Lap 1', distance: 10012.4, moving: 2900, elapsed: 3010, averageSpeed: 3.45, maxSpeed: 5.2, heartRate: { average: 152, max: 178 }, cadence: 172, elevationGain: 42.3 },
    ])
    expect(bestEfforts).toEqual([
      { index: 1, name: '1k', distance: 1000, moving: 270, elapsed: 270, prRank: 2 },
      { index: 2, name: '5k', distance: 5000, moving: 1420, elapsed: 1430, prRank: null },
    ])
  })

  it('accepts a detail with no splits, laps or efforts', () => {
    const parsed = parseStravaDetail({ ...summary, splits_metric: 'none' }, member)
    expect(parsed.ok && parsed.value.detail).toEqual({ calories: null, deviceName: null, splits: [], laps: [], bestEfforts: [] })
  })

  it('passes summary refusals through', () => {
    expect(parseStravaDetail({ ...detail, type: 'Swim', sport_type: 'Swim' }, member)).toEqual({ ok: false, error: 'not_a_run' })
    expect(parseStravaDetail('oops', member)).toEqual({ ok: false, error: 'not_an_object' })
  })
})

describe('parseStravaStreams', () => {
  const keyed = {
    time: { data: [0, 1, 2, 3] },
    distance: { data: [0, 3.1, 6.3, 9.4] },
    heartrate: { data: [120, 121.4, 123, 125] },
    cadence: { data: [84, 85, 86, 86] },
    velocity_smooth: { data: [3.1, 3.1, 3.2, 3.1] },
    altitude: { data: [900, 900.2, 900.4] },
  }

  it('reads keyed streams, doubles cadence and drops a series of the wrong length', () => {
    expect(parseStravaStreams(keyed)).toEqual({
      ok: true,
      value: {
        time: [0, 1, 2, 3],
        distance: [0, 3.1, 6.3, 9.4],
        heartRate: [120, 121, 123, 125],
        cadence: [168, 170, 172, 172],
        velocity: [3.1, 3.1, 3.2, 3.1],
        altitude: null,
      },
    })
  })

  it('reads the list form too', () => {
    const list = [
      { type: 'time', data: [0, 5] },
      { type: 'distance', data: [0, 15] },
    ]
    expect(parseStravaStreams(list)).toEqual({ ok: true, value: { time: [0, 5], distance: [0, 15], heartRate: null, cadence: null, velocity: null, altitude: null } })
  })

  it('refuses streams without time or distance, or with junk values', () => {
    expect(parseStravaStreams({ distance: { data: [0] } })).toEqual({ ok: false, error: 'no_time' })
    expect(parseStravaStreams({ time: { data: [0, 1] }, distance: { data: [0] } })).toEqual({ ok: false, error: 'no_distance' })
    expect(parseStravaStreams({ time: { data: [0, 'x'] }, distance: { data: [0, 1] } })).toEqual({ ok: false, error: 'no_time' })
    expect(parseStravaStreams(42)).toEqual({ ok: false, error: 'not_streams' })
  })
})

describe('parseStravaActivityId', () => {
  it('accepts positive integers as numbers or digits', () => {
    expect(parseStravaActivityId(98765)).toEqual({ ok: true, value: 98765 })
    expect(parseStravaActivityId('98765')).toEqual({ ok: true, value: 98765 })
  })
  it('refuses anything else', () => {
    for (const raw of [0, -1, 1.5, '01', '', 'abc', null, undefined, '99999999999999999']) {
      expect(parseStravaActivityId(raw).ok).toBe(false)
    }
  })
})

describe('rate limits', () => {
  const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null })

  it('reads overall and read windows', () => {
    const windows = parseRateLimits(headers({ 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '10,300', 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '79,500' }))
    expect(windows).toEqual([
      { used: 10, limit: 200 },
      { used: 300, limit: 2000 },
      { used: 79, limit: 100 },
      { used: 500, limit: 1000 },
    ])
    expect(overBudget(windows)).toBe(false)
  })

  it('stops at 80% of any window', () => {
    expect(overBudget(parseRateLimits(headers({ 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '80,100' })))).toBe(true)
    expect(overBudget(parseRateLimits(headers({ 'X-RateLimit-Limit': '100,1000', 'X-RateLimit-Usage': '3,800' })))).toBe(true)
  })

  it('reports nothing when headers are missing or malformed', () => {
    expect(parseRateLimits(headers({}))).toEqual([])
    expect(parseRateLimits(headers({ 'X-RateLimit-Limit': 'lots', 'X-RateLimit-Usage': '1,2' }))).toEqual([])
  })
})
