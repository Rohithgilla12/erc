import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { RunDetailView } from '@erc/contract'
import {
  downsampleStreams,
  timeInZones,
  type ActivitySource,
  type Bpm,
  type HeartRate,
  type LocalDate,
  type MemberId,
  type Metres,
  type MetresPerSecond,
  type RunDetail,
  type RunMetrics,
  type RunStreams,
  type Seconds,
  type SourceRef,
  type StepsPerMinute,
  type StoredActivity,
  type WorkoutType,
} from '@erc/domain'
import type { Payload } from 'payload'

import { instantOf } from './session'

/** The database or an open transaction. */
export type Executor = Pick<Payload['db']['drizzle'], 'execute'>

/** The activity row every metric row hangs off. */
export type ActivityKey = { member: MemberId; source: ActivitySource; ref: SourceRef }

// Numbers only, so the literal cannot carry anything but digits, signs, points and exponents.
const arrayOf = (values: readonly number[]): string => `{${values.join(',')}}`
const nullableArray = (values: readonly number[] | null): string | null => (values ? arrayOf(values) : null)

const keyColumns = (key: ActivityKey) => sql`${key.member}, ${key.source}, ${key.ref}`
const whereKey = (key: ActivityKey) => sql`member_id = ${key.member} AND source = ${key.source} AND ref = ${key.ref}`

/** Writes the summary columns only, so a later list sync never clears what a detail fetch added. */
export async function writeMetrics(db: Executor, key: ActivityKey, metrics: RunMetrics): Promise<void> {
  const hr = metrics.heartRate
  await db.execute(sql`
    INSERT INTO activity_metrics (
      member_id, source, ref, start_at, elapsed_s, has_heartrate, avg_hr, max_hr, avg_cadence_spm,
      elevation_gain_m, elev_high_m, elev_low_m, avg_speed_mps, max_speed_mps, workout_type
    ) VALUES (
      ${keyColumns(key)}, ${metrics.startAt}::timestamptz, ${metrics.elapsed}, ${hr !== null}, ${hr?.average ?? null}, ${hr?.max ?? null},
      ${metrics.cadence}, ${metrics.elevationGain}, ${metrics.elevationHigh}, ${metrics.elevationLow},
      ${metrics.averageSpeed}, ${metrics.maxSpeed}, ${metrics.workoutType}
    )
    ON CONFLICT (member_id, source, ref) DO UPDATE SET
      start_at = EXCLUDED.start_at, elapsed_s = EXCLUDED.elapsed_s, has_heartrate = EXCLUDED.has_heartrate,
      avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, avg_cadence_spm = EXCLUDED.avg_cadence_spm,
      elevation_gain_m = EXCLUDED.elevation_gain_m, elev_high_m = EXCLUDED.elev_high_m, elev_low_m = EXCLUDED.elev_low_m,
      avg_speed_mps = EXCLUDED.avg_speed_mps, max_speed_mps = EXCLUDED.max_speed_mps, workout_type = EXCLUDED.workout_type`)
}

const insertRows = async (db: Executor, into: SQL, rows: SQL[]) => {
  if (rows.length > 0) await db.execute(sql`INSERT INTO ${into} VALUES ${sql.join(rows, sql`, `)}`)
}

/** Replaces splits, laps and efforts wholesale, so writing the same detail twice converges. Call after `writeMetrics`. */
export async function writeDetail(db: Executor, key: ActivityKey, detail: RunDetail): Promise<void> {
  await db.execute(sql`UPDATE activity_metrics SET calories = ${detail.calories}, device_name = ${detail.deviceName}, detailed_at = now() WHERE ${whereKey(key)}`)
  await db.execute(sql`DELETE FROM activity_splits WHERE ${whereKey(key)}`)
  await db.execute(sql`DELETE FROM activity_laps WHERE ${whereKey(key)}`)
  await db.execute(sql`DELETE FROM activity_best_efforts WHERE ${whereKey(key)}`)
  await insertRows(
    db,
    sql`activity_splits (member_id, source, ref, split_index, metres, moving_s, elapsed_s, avg_hr, elevation_diff_m, pace_zone)`,
    detail.splits.map((s) => sql`(${keyColumns(key)}, ${s.index}, ${s.distance}, ${s.moving}, ${s.elapsed}, ${s.heartRate}, ${s.elevationDiff}, ${s.paceZone})`),
  )
  await insertRows(
    db,
    sql`activity_laps (member_id, source, ref, lap_index, name, metres, moving_s, elapsed_s, avg_speed_mps, max_speed_mps, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m)`,
    detail.laps.map(
      (l) =>
        sql`(${keyColumns(key)}, ${l.index}, ${l.name}, ${l.distance}, ${l.moving}, ${l.elapsed}, ${l.averageSpeed}, ${l.maxSpeed}, ${l.heartRate?.average ?? null}, ${l.heartRate?.max ?? null}, ${l.cadence}, ${l.elevationGain})`,
    ),
  )
  await insertRows(
    db,
    sql`activity_best_efforts (member_id, source, ref, effort_index, name, metres, moving_s, elapsed_s, pr_rank)`,
    detail.bestEfforts.map((e) => sql`(${keyColumns(key)}, ${e.index}, ${e.name}, ${e.distance}, ${e.moving}, ${e.elapsed}, ${e.prRank})`),
  )
}

export async function writeStreams(db: Executor, key: ActivityKey, streams: RunStreams): Promise<void> {
  await db.execute(sql`
    INSERT INTO activity_streams (member_id, source, ref, time_s, distance_m, heartrate_bpm, cadence_spm, velocity_mps, altitude_m)
    VALUES (
      ${keyColumns(key)}, ${arrayOf(streams.time)}::integer[], ${arrayOf(streams.distance)}::real[],
      ${nullableArray(streams.heartRate)}::smallint[], ${nullableArray(streams.cadence)}::smallint[],
      ${nullableArray(streams.velocity)}::real[], ${nullableArray(streams.altitude)}::real[]
    )
    ON CONFLICT (member_id, source, ref) DO UPDATE SET
      time_s = EXCLUDED.time_s, distance_m = EXCLUDED.distance_m, heartrate_bpm = EXCLUDED.heartrate_bpm,
      cadence_spm = EXCLUDED.cadence_spm, velocity_mps = EXCLUDED.velocity_mps, altitude_m = EXCLUDED.altitude_m`)
}

export type StoredRunDetail = Omit<RunDetailView, 'run'> & { run: StoredActivity }

/** Points per chart: enough for a phone-width line, few enough to keep the page small. */
export const CHART_POINTS = 300

type MetricsRow = {
  start_at: Date | string
  elapsed_s: number
  avg_hr: number | null
  max_hr: number | null
  avg_cadence_spm: number | null
  elevation_gain_m: number | null
  elev_high_m: number | null
  elev_low_m: number | null
  avg_speed_mps: number | null
  max_speed_mps: number | null
  calories: number | null
  workout_type: WorkoutType | null
  device_name: string | null
}
type SplitRow = { split_index: number; metres: number; moving_s: number; elapsed_s: number; avg_hr: number | null; elevation_diff_m: number | null; pace_zone: number | null }
type LapRow = {
  lap_index: number
  name: string | null
  metres: number
  moving_s: number
  elapsed_s: number
  avg_speed_mps: number | null
  max_speed_mps: number | null
  avg_hr: number | null
  max_hr: number | null
  avg_cadence_spm: number | null
  elevation_gain_m: number | null
}
type EffortRow = { effort_index: number; name: string; metres: number; moving_s: number; elapsed_s: number; pr_rank: 1 | 2 | 3 | null }
type StreamsRow = { time_s: number[]; distance_m: number[]; heartrate_bpm: number[] | null; cadence_spm: number[] | null; velocity_mps: number[] | null; altitude_m: number[] | null }

const heartRateOf = (average: number | null, max: number | null): HeartRate | null =>
  average !== null && max !== null ? { average: average as Bpm, max: max as Bpm } : null

/**
 * Everything stored about one run, or null when the member has no such run. Callers decide who may ask: the member
 * themself, or a coach the caller has already authorised.
 */
export async function readRunDetail(db: Executor, key: ActivityKey): Promise<StoredRunDetail | null> {
  const where = whereKey(key)
  const stravaId = key.source === 'strava' ? key.ref.slice('strava:'.length) : null
  const [activity, metrics, splits, laps, efforts, streams, pending, ceiling] = await Promise.all([
    db.execute(sql`SELECT on_date::text AS on_date, metres, moving_s, logged_at, note FROM activities WHERE ${where}`),
    db.execute(sql`SELECT * FROM activity_metrics WHERE ${where}`),
    db.execute(sql`SELECT * FROM activity_splits WHERE ${where} ORDER BY split_index`),
    db.execute(sql`SELECT * FROM activity_laps WHERE ${where} ORDER BY lap_index`),
    db.execute(sql`SELECT * FROM activity_best_efforts WHERE ${where} ORDER BY effort_index`),
    db.execute(sql`SELECT time_s, distance_m, heartrate_bpm, cadence_spm, velocity_mps, altitude_m FROM activity_streams WHERE ${where}`),
    stravaId === null
      ? Promise.resolve({ rows: [] })
      : db.execute(sql`SELECT 1 FROM strava_jobs WHERE member_id = ${key.member} AND strava_activity_id = ${stravaId}::bigint LIMIT 1`),
    db.execute(sql`SELECT max(max_hr)::int AS max_hr FROM activity_metrics WHERE member_id = ${key.member} AND start_at > now() - interval '12 months'`),
  ])
  const row = activity.rows[0] as { on_date: string; metres: number; moving_s: number; logged_at: Date | string; note: string | null } | undefined
  if (!row) return null

  const m = metrics.rows[0] as MetricsRow | undefined
  const s = streams.rows[0] as StreamsRow | undefined
  const runStreams: RunStreams | null = s
    ? { time: s.time_s, distance: s.distance_m, heartRate: s.heartrate_bpm, cadence: s.cadence_spm, velocity: s.velocity_mps, altitude: s.altitude_m }
    : null
  const estimatedMaxHr = (ceiling.rows[0] as { max_hr: number | null } | undefined)?.max_hr ?? null

  return {
    run: {
      member: key.member,
      source: key.source,
      ref: key.ref,
      on: row.on_date as LocalDate,
      distance: row.metres as Metres,
      moving: row.moving_s as Seconds,
      loggedAt: instantOf(row.logged_at),
      ...(row.note !== null ? { note: row.note } : {}),
    },
    metrics: m
      ? {
          startAt: instantOf(m.start_at),
          elapsed: m.elapsed_s as Seconds,
          heartRate: heartRateOf(m.avg_hr, m.max_hr),
          cadence: m.avg_cadence_spm as StepsPerMinute | null,
          elevationGain: m.elevation_gain_m,
          elevationHigh: m.elev_high_m,
          elevationLow: m.elev_low_m,
          averageSpeed: m.avg_speed_mps as MetresPerSecond | null,
          maxSpeed: m.max_speed_mps as MetresPerSecond | null,
          workoutType: m.workout_type,
          calories: m.calories,
          deviceName: m.device_name,
        }
      : null,
    splits: (splits.rows as SplitRow[]).map((r) => ({
      index: r.split_index,
      distance: r.metres,
      moving: r.moving_s as Seconds,
      elapsed: r.elapsed_s as Seconds,
      heartRate: r.avg_hr as Bpm | null,
      elevationDiff: r.elevation_diff_m,
      paceZone: r.pace_zone,
    })),
    laps: (laps.rows as LapRow[]).map((r) => ({
      index: r.lap_index,
      name: r.name,
      distance: r.metres,
      moving: r.moving_s as Seconds,
      elapsed: r.elapsed_s as Seconds,
      averageSpeed: r.avg_speed_mps as MetresPerSecond | null,
      maxSpeed: r.max_speed_mps as MetresPerSecond | null,
      heartRate: heartRateOf(r.avg_hr, r.max_hr),
      cadence: r.avg_cadence_spm as StepsPerMinute | null,
      elevationGain: r.elevation_gain_m,
    })),
    bestEfforts: (efforts.rows as EffortRow[]).map((r) => ({
      index: r.effort_index,
      name: r.name,
      distance: r.metres,
      moving: r.moving_s as Seconds,
      elapsed: r.elapsed_s as Seconds,
      prRank: r.pr_rank,
    })),
    charts: runStreams ? downsampleStreams(runStreams, CHART_POINTS) : null,
    zones:
      runStreams?.heartRate && estimatedMaxHr
        ? { estimatedMaxHr, zones: timeInZones(runStreams.time, runStreams.heartRate, estimatedMaxHr as Bpm) }
        : null,
    syncing: pending.rows.length > 0,
  }
}
