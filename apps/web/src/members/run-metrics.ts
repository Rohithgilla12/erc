import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import type { ActivitySource, MemberId, RunDetail, RunMetrics, RunStreams, SourceRef } from '@erc/domain'
import type { Payload } from 'payload'

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
