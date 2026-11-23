import type { Brand, Instant, Seconds } from './primitives'

export type Bpm = Brand<number, 'Bpm'>
/** Both feet. A source that counts one leg, as Strava does, is doubled when parsed. */
export type StepsPerMinute = Brand<number, 'StepsPerMinute'>
export type MetresPerSecond = Brand<number, 'MetresPerSecond'>

export const WORKOUT_TYPES = ['default', 'race', 'long', 'workout'] as const
export type WorkoutType = (typeof WORKOUT_TYPES)[number]

/** Average and maximum come together or not at all, so a run either has heart rate or it does not. */
export type HeartRate = { average: Bpm; max: Bpm }

/** What a whole run measured, whatever device or service it came from. Unmeasured values are null. */
export type RunMetrics = {
  startAt: Instant
  elapsed: Seconds
  heartRate: HeartRate | null
  cadence: StepsPerMinute | null
  elevationGain: number | null
  elevationHigh: number | null
  elevationLow: number | null
  averageSpeed: MetresPerSecond | null
  maxSpeed: MetresPerSecond | null
  workoutType: WorkoutType | null
}

export type Split = {
  index: number
  distance: number
  moving: Seconds
  elapsed: Seconds
  heartRate: Bpm | null
  elevationDiff: number | null
  paceZone: number | null
}

export type Lap = {
  index: number
  name: string | null
  distance: number
  moving: Seconds
  elapsed: Seconds
  averageSpeed: MetresPerSecond | null
  maxSpeed: MetresPerSecond | null
  heartRate: HeartRate | null
  cadence: StepsPerMinute | null
  elevationGain: number | null
}

export type BestEffort = { index: number; name: string; distance: number; moving: Seconds; elapsed: Seconds; prRank: 1 | 2 | 3 | null }

/** Everything beyond the summary: what a detail fetch or a full file adds. */
export type RunDetail = { calories: number | null; deviceName: string | null; splits: readonly Split[]; laps: readonly Lap[]; bestEfforts: readonly BestEffort[] }

/** Sample-aligned series. `time` and `distance` are always present; every other series has their length or is null. */
export type RunStreams = {
  time: readonly number[]
  distance: readonly number[]
  heartRate: readonly number[] | null
  cadence: readonly number[] | null
  velocity: readonly number[] | null
  altitude: readonly number[] | null
}

/** Each chart series is sampled at `distance`; null marks a bucket with no usable value, drawn as a gap. */
export type ChartSeries = {
  distance: readonly number[]
  heartRate: readonly (number | null)[] | null
  pace: readonly (number | null)[] | null
  cadence: readonly (number | null)[] | null
  altitude: readonly (number | null)[] | null
}

/** Slower than 16:40 per km is standing or walking, and would flatten the pace chart if drawn. */
const STOPPED_BELOW_MPS = 1

const meanOf = (values: readonly number[], from: number, to: number): number | null => {
  let sum = 0
  let count = 0
  for (let i = from; i < to; i++) {
    const value = values[i]
    if (value !== undefined && Number.isFinite(value)) {
      sum += value
      count++
    }
  }
  return count > 0 ? sum / count : null
}

/** Means over equal runs of samples, so a 10,000-sample run draws as `maxPoints` points without aliasing spikes. */
export const downsampleStreams = (streams: RunStreams, maxPoints: number): ChartSeries => {
  const length = streams.time.length
  const buckets = Math.max(1, Math.min(maxPoints, length))
  const bounds = Array.from({ length: buckets }, (_, b) => [Math.floor((b * length) / buckets), Math.floor(((b + 1) * length) / buckets)] as const)
  const series = (values: readonly number[] | null, map: (mean: number) => number | null = (mean) => mean) =>
    values ? bounds.map(([from, to]) => {
      const mean = meanOf(values, from, to)
      return mean === null ? null : map(mean)
    }) : null
  return {
    distance: bounds.map(([from, to]) => meanOf(streams.distance, from, to) ?? 0),
    heartRate: series(streams.heartRate, Math.round),
    pace: series(streams.velocity, (speed) => (speed < STOPPED_BELOW_MPS ? null : 1000 / speed)),
    cadence: series(streams.cadence, Math.round),
    altitude: series(streams.altitude),
  }
}

/** Five zones as fractions of maximum heart rate. Zone 1 takes everything below 60%. */
export const HR_ZONES = [
  { zone: 1, from: 0, to: 0.6 },
  { zone: 2, from: 0.6, to: 0.7 },
  { zone: 3, from: 0.7, to: 0.8 },
  { zone: 4, from: 0.8, to: 0.9 },
  { zone: 5, from: 0.9, to: Infinity },
] as const

export type ZoneTime = { zone: (typeof HR_ZONES)[number]['zone']; fromBpm: number; toBpm: number | null; seconds: number }

/** A gap longer than this between samples is a pause, not time spent at the earlier heart rate. */
const MAX_SAMPLE_GAP_S = 30

/** Seconds in each zone, crediting each sample interval to the heart rate at its start. */
export const timeInZones = (time: readonly number[], heartRate: readonly number[], maxHr: Bpm): readonly ZoneTime[] => {
  const seconds = HR_ZONES.map(() => 0)
  for (let i = 0; i + 1 < time.length; i++) {
    const gap = (time[i + 1] ?? 0) - (time[i] ?? 0)
    const bpm = heartRate[i]
    if (gap <= 0 || gap > MAX_SAMPLE_GAP_S || bpm === undefined || bpm <= 0) continue
    const fraction = bpm / maxHr
    const zone = HR_ZONES.findIndex((z) => fraction >= z.from && fraction < z.to)
    if (zone >= 0) seconds[zone] = (seconds[zone] ?? 0) + gap
  }
  return HR_ZONES.map((z, i) => ({
    zone: z.zone,
    fromBpm: Math.round(z.from * maxHr),
    toBpm: Number.isFinite(z.to) ? Math.round(z.to * maxHr) : null,
    seconds: seconds[i] ?? 0,
  }))
}
