import type { Moderation, Submitter } from './moderation'
import {
  daysBetween,
  notImplemented,
  parseLocalDate,
  type HttpsUrl,
  type Id,
  type LocalDate,
  type Metres,
  type NonEmpty,
  type Result,
  type Seconds,
  type Slug,
  type Subdivision,
} from './primitives'
import { DISCIPLINES, DISTANCE_BANDS, type Discipline, type DistanceBand, type DistanceCategory } from './running'

export type RaceLocation =
  | { kind: 'venue'; venue: string; city: string; subdivision: Subdivision; country: 'IN' | (string & {}) }
  | { kind: 'virtual' }

export type RaceDistanceOption = {
  metres: Metres
  /** Derived from `metres` by the CMS hook and stored, so calendar filters are indexed equalities. */
  category: DistanceCategory
  band: DistanceBand
  elevationGainMetres?: Metres
  terrain?: 'road' | 'trail' | 'mixed' | 'track'
  cutoff?: Seconds
}

/** Postponed and cancelled races stay listed with a badge, so a runner who saved the link learns what happened. */
export type RaceStatus = { kind: 'scheduled' } | { kind: 'postponed'; newStart: LocalDate | null } | { kind: 'cancelled' }

export type RaceSource =
  | { kind: 'organiser'; url: HttpsUrl }
  | { kind: 'listing-site'; name: string; url: HttpsUrl }
  | { kind: 'runner-submission' }
  | { kind: 'coach-knowledge'; coach: Id<'coaches'> }

export type Race = {
  id: Id<'races'>
  slug: Slug
  name: string
  discipline: Discipline
  /** A multi-day event is a start plus a day count, so an end date before the start cannot be built. */
  dates: { start: LocalDate; dayCount: number }
  timeZone: 'Asia/Kolkata' | (string & {})
  location: RaceLocation
  distances: NonEmpty<RaceDistanceOption>
  officialUrl: HttpsUrl
  registration: { url: HttpsUrl; closesOn: LocalDate | null }
  status: RaceStatus
  /** Shown on the page. Re-checking a race bumps `lastVerifiedOn` and nothing else. */
  source: RaceSource
  lastVerifiedOn: LocalDate
  summary: string
  moderation: Moderation
}

export type PublicRace = Race & { moderation: { state: 'approved' } }

/** Derived at render from `lastVerifiedOn`, never stored. */
export const VERIFICATION_STALE_AFTER_DAYS = 90
export const isVerificationStale = (race: Pick<Race, 'lastVerifiedOn'>, today: LocalDate): boolean =>
  daysBetween(race.lastVerifiedOn, today) > VERIFICATION_STALE_AFTER_DAYS

export type RaceQuery = {
  from: LocalDate
  to: LocalDate | null
  disciplines: readonly Discipline[]
  bands: readonly DistanceBand[]
  subdivision: Subdivision | null
  includeVirtual: boolean
  registrationOpen: boolean
  text: string | null
  page: number
}

export type RaceFacets = {
  disciplines: Readonly<Partial<Record<Discipline, number>>>
  bands: Readonly<Partial<Record<DistanceBand, number>>>
  subdivisions: readonly { subdivision: Subdivision; count: number }[]
}

export type RacePage = {
  races: readonly PublicRace[]
  page: number
  totalPages: number
  /** Counts for the current query minus each facet's own filter, so every chip shows what tapping it would yield. */
  facets: RaceFacets
  /** Indexable landing route for this query, or null when the combination should be `noindex`. */
  canonicalPath: string | null
}

export type QueryParams = Readonly<Record<string, string | readonly string[] | undefined>>

const valuesOf = (raw: unknown): string[] =>
  typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []

const firstOf = (raw: unknown): string => valuesOf(raw)[0]?.trim() ?? ''

const listOf = (raw: unknown): string[] =>
  valuesOf(raw)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '')

/** Filtering the known table, rather than the input, de-duplicates and gives one canonical order. */
const knownIn = <T extends string>(known: readonly T[], wanted: readonly string[]): T[] => {
  const set = new Set(wanted.map((w) => w.toLowerCase()))
  return known.filter((k) => set.has(k))
}

const SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/
const parseSubdivision = (raw: string): Subdivision | null => {
  const upper = raw.toUpperCase()
  return SUBDIVISION.test(upper) ? (upper as Subdivision) : null
}

const BAND_KEYS = DISTANCE_BANDS.map((b) => b.key)
const MAX_TEXT_CHARS = 100
const MAX_PAGE = 1000
// encodeURIComponent throws on an unpaired surrogate, so one in `q` would crash serialisation.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

const parseText = (raw: string): string | null => {
  const collapsed = raw.replace(LONE_SURROGATE, '').replace(/\s+/g, ' ').trim()
  const clipped = Array.from(collapsed).slice(0, MAX_TEXT_CHARS).join('').trim()
  return clipped === '' ? null : clipped
}

const parsePage = (raw: string): number => {
  const page = /^\d{1,4}$/.test(raw) ? Number(raw) : 0
  return page >= 1 && page <= MAX_PAGE ? page : 1
}

const dateOrNull = (raw: string): LocalDate | null => {
  const parsed = parseLocalDate(raw)
  return parsed.ok ? parsed.value : null
}

/**
 * Boundary parser for URL query params. Unknown values are dropped, never thrown on.
 *
 * Params: `from`, `to` (`YYYY-MM-DD`); `discipline`, `band` (repeated or comma-separated);
 * `state` (ISO 3166-2, any case); `virtual=1`; `open=1`; `q` (whitespace collapsed, clipped to 100 characters);
 * `page` (1 to 1000). `from` defaults to `today`, `page` to 1, everything else to empty.
 */
export const parseRaceQuery = (params: QueryParams, today: LocalDate): RaceQuery => ({
  from: dateOrNull(firstOf(params.from)) ?? today,
  to: dateOrNull(firstOf(params.to)),
  disciplines: knownIn(DISCIPLINES, listOf(params.discipline)),
  bands: knownIn(BAND_KEYS, listOf(params.band)),
  subdivision: parseSubdivision(firstOf(params.state)),
  includeVirtual: firstOf(params.virtual) === '1',
  registrationOpen: firstOf(params.open) === '1',
  text: parseText(firstOf(params.q)),
  page: parsePage(firstOf(params.page)),
})

/**
 * Inverse of `parseRaceQuery`. Returns a query string without `?`, omitting defaults, so links stay short and shareable.
 * Keys come in a fixed order and lists in table order, so equal queries give byte-identical strings for cache keys.
 */
export const serialiseRaceQuery = (query: RaceQuery, today: LocalDate): string => {
  const disciplines = knownIn(DISCIPLINES, query.disciplines)
  const bands = knownIn(BAND_KEYS, query.bands)
  const pairs: [string, string | null][] = [
    ['from', query.from === today ? null : query.from],
    ['to', query.to],
    ['discipline', disciplines.length > 0 ? disciplines.join(',') : null],
    ['band', bands.length > 0 ? bands.join(',') : null],
    ['state', query.subdivision],
    ['virtual', query.includeVirtual ? '1' : null],
    ['open', query.registrationOpen ? '1' : null],
    ['q', query.text === null ? null : encodeURIComponent(query.text)],
    ['page', query.page === 1 ? null : String(query.page)],
  ]
  return pairs
    .filter((pair): pair is [string, string] => pair[1] !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/** Submitters give raw metres; `category` and `band` are derived, never accepted from a form. */
export type RaceSubmission = Omit<Race, 'id' | 'slug' | 'moderation' | 'lastVerifiedOn' | 'status' | 'source' | 'distances'> & {
  distances: NonEmpty<Omit<RaceDistanceOption, 'category' | 'band'>>
  submitter: Submitter
}
/** Takes plain fields, not `FormData`, so the same parser serves the web form and a future mobile client. */
export const parseRaceSubmission = (
  input: Readonly<Record<string, unknown>>,
): Result<RaceSubmission, Readonly<Record<string, string>>> => notImplemented()

/** RFC 5545 all-day event(s); deterministic UID per race so re-importing updates rather than duplicates. */
export const toIcs = (race: PublicRace): string => notImplemented()
export const googleCalendarUrl = (race: PublicRace): HttpsUrl => notImplemented()
