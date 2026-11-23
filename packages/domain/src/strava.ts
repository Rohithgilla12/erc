import { parseStravaRun, type SourceRef, type StoredActivity } from './activities'
import type { MemberId } from './members'
import { err, instantOf, ok, type Brand, type Result, type Seconds } from './primitives'
import type { BestEffort, Bpm, HeartRate, Lap, MetresPerSecond, RunDetail, RunMetrics, RunStreams, Split, StepsPerMinute, WorkoutType } from './run-metrics'

export type StravaActivityId = Brand<number, 'StravaActivityId'>

export const parseStravaActivityId = (raw: unknown): Result<StravaActivityId, 'not_an_id'> => {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : ''
  if (!/^[1-9]\d{0,15}$/.test(text)) return err('not_an_id')
  const id = Number(text)
  return Number.isSafeInteger(id) ? ok(id as StravaActivityId) : err('not_an_id')
}

export const stravaRef = (id: StravaActivityId): SourceRef => `strava:${id}` as SourceRef

export type StravaRefusal = 'not_an_object' | 'not_an_id' | 'not_a_run' | 'invalid_distance' | 'invalid_pace' | 'invalid_date'

/** A run as Strava's list and detail endpoints both describe it: the activity row and its whole-run metrics. */
export type StravaSummary = { id: StravaActivityId; activity: StoredActivity<'strava'>; metrics: RunMetrics }
export type StravaDetail = StravaSummary & { detail: RunDetail }

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const inRange = (value: unknown, min: number, max: number): number | null => {
  const n = finite(value)
  return n !== null && n >= min && n <= max ? n : null
}

const wholeIn = (value: unknown, min: number, max: number): number | null => {
  const n = inRange(value, min, max)
  return n === null ? null : Math.round(n)
}

const seconds = (value: unknown): Seconds | null => {
  const n = inRange(value, 0, 7 * 86_400)
  return n === null ? null : (Math.round(n) as Seconds)
}

const bpm = (value: unknown): Bpm | null => {
  const n = inRange(value, 25, 250)
  return n === null ? null : (Math.round(n) as Bpm)
}

const heartRateOf = (average: unknown, max: unknown): HeartRate | null => {
  const [a, m] = [bpm(average), bpm(max)]
  return a !== null && m !== null ? { average: a, max: m } : null
}

/** Strava counts one foot's strikes; runners and every other source count both. */
const stepsPerMinute = (perLeg: unknown): StepsPerMinute | null => {
  const n = inRange(perLeg, 30, 130)
  return n === null ? null : (Math.round(n * 2) as StepsPerMinute)
}

const speed = (value: unknown): MetresPerSecond | null => {
  const n = inRange(value, 0, 15)
  return n === null || n === 0 ? null : (n as MetresPerSecond)
}

const metresAbout = (value: unknown): number | null => inRange(value, -500, 9000)

const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null)

// Strava's run workout_type: 0 default, 1 race, 2 long run, 3 workout. Ride codes (10-12) are not runs.
const WORKOUT_CODES: Readonly<Record<number, WorkoutType>> = { 0: 'default', 1: 'race', 2: 'long', 3: 'workout' }

const isoInstant = (value: unknown) => {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : instantOf(new Date(ms).toISOString())
}

const summaryOf = (raw: Json, member: MemberId): Result<StravaSummary, StravaRefusal> => {
  const id = parseStravaActivityId(raw.id)
  if (!id.ok) return err('not_an_id')
  const startAt = isoInstant(raw.start_date)
  if (!startAt || typeof raw.start_date_local !== 'string') return err('invalid_date')
  const distance = finite(raw.distance)
  const movingTime = finite(raw.moving_time)
  if (distance === null) return err('invalid_distance')
  if (movingTime === null) return err('invalid_pace')
  const activity = parseStravaRun(
    {
      id: id.value,
      distance,
      moving_time: movingTime,
      start_date_local: raw.start_date_local,
      ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      ...(typeof raw.type === 'string' ? { type: raw.type } : {}),
      ...(typeof raw.sport_type === 'string' ? { sport_type: raw.sport_type } : {}),
    },
    member,
  )
  if (!activity.ok) return activity
  const workoutCode = finite(raw.workout_type)
  return ok({
    id: id.value,
    activity: activity.value,
    metrics: {
      startAt,
      elapsed: (Math.max(seconds(raw.elapsed_time) ?? 0, activity.value.moving) as Seconds),
      heartRate: raw.has_heartrate === false ? null : heartRateOf(raw.average_heartrate, raw.max_heartrate),
      cadence: stepsPerMinute(raw.average_cadence),
      elevationGain: inRange(raw.total_elevation_gain, 0, 20_000),
      elevationHigh: metresAbout(raw.elev_high),
      elevationLow: metresAbout(raw.elev_low),
      averageSpeed: speed(raw.average_speed),
      maxSpeed: speed(raw.max_speed),
      workoutType: workoutCode === null ? null : (WORKOUT_CODES[workoutCode] ?? null),
    },
  })
}

/** Parses one activity from `/athlete/activities` or `/activities/{id}`. Fields that are absent or implausible become null. */
export const parseStravaSummary = (raw: unknown, member: MemberId): Result<StravaSummary, StravaRefusal> =>
  isRecord(raw) ? summaryOf(raw, member) : err('not_an_object')

const listOf = <T>(raw: unknown, parse: (item: Json, position: number) => T | null): readonly T[] =>
  Array.isArray(raw) ? raw.flatMap((item, i) => (isRecord(item) ? (parse(item, i + 1) ?? []) : [])) : []

const timed = (item: Json) => {
  const distance = inRange(item.distance, 0, 300_000)
  const moving = seconds(item.moving_time)
  const elapsed = seconds(item.elapsed_time)
  return distance === null || moving === null || elapsed === null ? null : { distance, moving, elapsed: Math.max(elapsed, moving) as Seconds }
}

const splitOf = (item: Json, position: number): Split | null => {
  const base = timed(item)
  if (!base) return null
  return {
    index: wholeIn(item.split, 1, 1000) ?? position,
    ...base,
    heartRate: bpm(item.average_heartrate),
    elevationDiff: inRange(item.elevation_difference, -5000, 5000),
    paceZone: wholeIn(item.pace_zone, 0, 10),
  }
}

const lapOf = (item: Json, position: number): Lap | null => {
  const base = timed(item)
  if (!base) return null
  return {
    index: wholeIn(item.lap_index, 1, 1000) ?? position,
    name: text(item.name, 80),
    ...base,
    averageSpeed: speed(item.average_speed),
    maxSpeed: speed(item.max_speed),
    heartRate: heartRateOf(item.average_heartrate, item.max_heartrate),
    cadence: stepsPerMinute(item.average_cadence),
    elevationGain: inRange(item.total_elevation_gain, 0, 20_000),
  }
}

const effortOf = (item: Json, position: number): BestEffort | null => {
  const base = timed(item)
  const name = text(item.name, 40)
  if (!base || !name) return null
  const rank = item.pr_rank
  return { index: position, name, ...base, prRank: rank === 1 || rank === 2 || rank === 3 ? rank : null }
}

/** Parses `/activities/{id}`: the summary plus splits, laps, best efforts, calories and device. */
export const parseStravaDetail = (raw: unknown, member: MemberId): Result<StravaDetail, StravaRefusal> => {
  if (!isRecord(raw)) return err('not_an_object')
  const summary = summaryOf(raw, member)
  if (!summary.ok) return summary
  // Strava numbers splits and laps itself; a repeated number would collide on the table's key, so first one wins.
  const unique = <T extends { index: number }>(items: readonly T[]) => items.filter((item, i) => items.findIndex((other) => other.index === item.index) === i)
  return ok({
    ...summary.value,
    detail: {
      calories: wholeIn(raw.calories, 0, 20_000),
      deviceName: text(raw.device_name, 120),
      splits: unique(listOf(raw.splits_metric, splitOf)),
      laps: unique(listOf(raw.laps, lapOf)),
      bestEfforts: listOf(raw.best_efforts, effortOf),
    },
  })
}

export const STREAM_KEYS = ['time', 'distance', 'heartrate', 'cadence', 'velocity_smooth', 'altitude'] as const

/** Streams come keyed by type (`key_by_type=true`) or, from older clients, as a list of `{ type, data }`. */
const streamTable = (raw: unknown): Json | null => {
  if (isRecord(raw)) return raw
  if (!Array.isArray(raw)) return null
  return Object.fromEntries(raw.flatMap((item) => (isRecord(item) && typeof item.type === 'string' ? [[item.type, item]] : [])))
}

const numbers = (stream: unknown, length: number | null): number[] | null => {
  const data = isRecord(stream) ? stream.data : null
  if (!Array.isArray(data) || data.length === 0 || (length !== null && data.length !== length)) return null
  return data.every((value) => typeof value === 'number' && Number.isFinite(value)) ? (data as number[]) : null
}

/** A series that does not line up with `time` is dropped rather than drawn against the wrong moment. */
export const parseStravaStreams = (raw: unknown): Result<RunStreams, 'not_streams' | 'no_time' | 'no_distance'> => {
  const table = streamTable(raw)
  if (!table) return err('not_streams')
  const time = numbers(table.time, null)
  if (!time) return err('no_time')
  const distance = numbers(table.distance, time.length)
  if (!distance) return err('no_distance')
  const heartRate = numbers(table.heartrate, time.length)
  const cadence = numbers(table.cadence, time.length)
  return ok({
    time: time.map(Math.round),
    distance,
    heartRate: heartRate ? heartRate.map(Math.round) : null,
    cadence: cadence ? cadence.map((perLeg) => Math.round(perLeg * 2)) : null,
    velocity: numbers(table.velocity_smooth, time.length),
    altitude: numbers(table.altitude, time.length),
  })
}

export type RateWindow = { used: number; limit: number }

type HeaderSource = { get(name: string): string | null }

const pairs = (value: string | null): number[] => (value ?? '').split(',').map((part) => Number(part.trim())).filter((n) => Number.isFinite(n))

/**
 * Strava sends `X-RateLimit-*` for all requests and `X-ReadRateLimit-*` for reads, each as "15-minute,daily". Every
 * window present is returned; a header pair that does not parse contributes nothing.
 */
export const parseRateLimits = (headers: HeaderSource): readonly RateWindow[] =>
  ['X-RateLimit', 'X-ReadRateLimit'].flatMap((prefix) => {
    const used = pairs(headers.get(`${prefix}-Usage`))
    const limit = pairs(headers.get(`${prefix}-Limit`))
    return limit.flatMap((max, i) => {
      const count = used[i]
      return count !== undefined && max > 0 ? [{ used: count, limit: max }] : []
    })
  })

/** Stop once any window reaches this share, leaving the rest for list syncs members start by hand. */
export const STRAVA_BUDGET_SHARE = 0.8

export const overBudget = (windows: readonly RateWindow[], share = STRAVA_BUDGET_SHARE): boolean => windows.some((w) => w.used >= w.limit * share)
