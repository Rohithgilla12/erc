import { collect, firstOf, type FieldErrors } from './form-fields'
import type { MemberId, RawInput } from './members'
import { err, isUuid, ok, parseLocalDate, type Brand, type Instant, type LocalDate, type Metres, type Result, type Seconds } from './primitives'

export const ACTIVITY_SOURCES = ['manual', 'file', 'strava'] as const
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

/**
 * Sources a public number may come from. Strava is absent: Strava data may be shown only to the athlete it came from,
 * so no type that feeds a board or a public profile can hold it.
 */
export const PUBLIC_SOURCES = ['manual', 'file'] as const satisfies readonly ActivitySource[]
export type PublicSource = (typeof PUBLIC_SOURCES)[number]

/** Unique per member and source: a manual entry's UUID, a file's SHA-256, a Strava activity id. Writing it twice converges. */
export type SourceRef = Brand<string, 'SourceRef'>

export const parseSourceRef = (raw: unknown): Result<SourceRef, 'not_a_ref'> => {
  const value = firstOf(raw)
  return isUuid(value) ? ok(value.toLowerCase() as SourceRef) : err('not_a_ref')
}

/** One source's record of a run, as stored. `on` is fixed in IST when the row is written. */
export type Activity<S extends ActivitySource = ActivitySource> = {
  member: MemberId
  source: S
  ref: SourceRef
  on: LocalDate
  distance: Metres
  moving: Seconds
  loggedAt: Instant
}

export type Totals = { distance: Metres; moving: Seconds; runs: number }

export const totalsOf = (runs: readonly Pick<Activity, 'distance' | 'moving'>[]): Totals => ({
  distance: runs.reduce((sum, run) => sum + run.distance, 0) as Metres,
  moving: runs.reduce((sum, run) => sum + run.moving, 0) as Seconds,
  runs: runs.length,
})

/** No one runs further than this in a day. */
export const MAX_RUN_METRES = 250_000 as Metres
/** Faster than the fastest road pace anyone has held, so a mistyped distance or time is caught at entry. */
export const MIN_SECONDS_PER_KM = 150
/** Nobody is back-filling a log from before this; a year typed with a missing digit is caught instead. */
export const EARLIEST_RUN_DATE = '2000-01-01' as LocalDate
/** Manual entries one member may log in an hour. A back-fill fits; a script filling the table does not. */
export const RUNS_LOGGED_PER_HOUR = 60

/**
 * `ref` lets a form or client retry the same entry without logging it twice; the shell mints one when it is absent.
 * Duration is required: a board of distance without time cannot be sanity-checked.
 */
export type ManualEntry = { ref: SourceRef | null; on: LocalDate; distance: Metres; moving: Seconds }

const DISTANCE_KM = /^\d{1,3}(?:[.,]\d{1,3})?$/

const distanceKm = (raw: string): Result<Metres, string> => {
  const text = raw.replace(',', '.')
  if (!DISTANCE_KM.test(text)) return err('Enter the distance in kilometres, such as 6.2.')
  const metres = Math.round(Number(text) * 1000)
  if (metres <= 0) return err('Enter the distance in kilometres, such as 6.2.')
  return metres > MAX_RUN_METRES ? err(`That is over ${MAX_RUN_METRES / 1000} km. Check the distance.`) : ok(metres as Metres)
}

const DURATION = /^(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)$/

/** `mm:ss` or `h:mm:ss`. */
export const parseDuration = (raw: string): Result<Seconds, string> => {
  const match = DURATION.exec(raw.trim())
  if (!match) return err('Enter the time as minutes:seconds, such as 38:10, or hours:minutes:seconds.')
  const [, hours = '0', minutes = '0', seconds = '0'] = match
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
  return total > 0 ? ok(total as Seconds) : err('Enter the time as minutes:seconds, such as 38:10, or hours:minutes:seconds.')
}

const runDate = (raw: string, today: LocalDate): Result<LocalDate, string> => {
  if (raw === '') return ok(today)
  const parsed = parseLocalDate(raw)
  if (!parsed.ok) return err('Enter the date as YYYY-MM-DD.')
  if (parsed.value < EARLIEST_RUN_DATE) return err('That date is before 2000. Check the year.')
  return parsed.value > today ? err('That date is still to come.') : parsed
}

const ref = (raw: unknown): Result<SourceRef | null, string> => {
  if (firstOf(raw) === '') return ok(null)
  const parsed = parseSourceRef(raw)
  return parsed.ok ? parsed : err('The entry reference is not valid.')
}

/**
 * Takes plain fields: `date` (defaults to today; from 2000-01-01 to today), `distanceKm`, `duration` (`mm:ss` or
 * `h:mm:ss`), and an optional `ref`. Refuses over 250 km and an average pace faster than 2:30 per km.
 */
export const parseManualEntry = (fields: RawInput, today: LocalDate): Result<ManualEntry, FieldErrors> => {
  const collected = collect({
    ref: ref(fields.ref),
    date: runDate(firstOf(fields.date), today),
    distanceKm: distanceKm(firstOf(fields.distanceKm)),
    duration: parseDuration(firstOf(fields.duration)),
  })
  if (!collected.ok) return collected
  const { date, distanceKm: distance, duration: moving } = collected.value
  if (moving / (distance / 1000) < MIN_SECONDS_PER_KM) return err({ duration: 'That pace is faster than 2:30 per km. Check the distance and time.' })
  return ok({ ref: collected.value.ref, on: date, distance, moving })
}

/** Seconds as `h:mm:ss` or `m:ss`, for the dashboard. */
export const formatDuration = (seconds: Seconds): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const mmss = `${hours > 0 ? String(minutes).padStart(2, '0') : minutes}:${String(rest).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/** Metres as kilometres with one decimal, for the dashboard. */
export const formatKm = (metres: Metres): string => `${(metres / 1000).toFixed(1)} km`
