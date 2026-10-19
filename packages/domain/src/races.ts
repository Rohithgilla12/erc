import type { Moderation, StaffId, Submitter } from './moderation'
import {
  addDays,
  daysBetween,
  err,
  ok,
  parseLocalDate,
  type Email,
  type HttpsUrl,
  type Id,
  type LocalDate,
  type Metres,
  type NonEmpty,
  type Result,
  type Seconds,
  type Slug,
} from './primitives'
import { DISCIPLINES, DISTANCE_BANDS, type Discipline, type DistanceBand, type DistanceCategory } from './running'
import { parseSubdivision, subdivisionOf, type Subdivision } from './subdivisions'

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
  /** Points at staff, not a coach profile: records never reference editorial. Pages show "ERC coaches", not the person. */
  | { kind: 'coach-knowledge'; confirmedBy: StaffId }

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
  /** Races matching the query across all pages. */
  total: number
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
 * `state` (a known ISO 3166-2 code, any case); `virtual=1`; `open=1`; `q` (whitespace collapsed, clipped to 100 characters);
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

export const RACES_PATH = '/races'
const LANDING_SEGMENTS = { state: 'in', discipline: 'discipline' } as const
export const stateLandingPath = (subdivision: Subdivision): string =>
  `${RACES_PATH}/${LANDING_SEGMENTS.state}/${subdivisionOf(subdivision).slug}`
export const disciplineLandingPath = (discipline: Discipline): string => `${RACES_PATH}/${LANDING_SEGMENTS.discipline}/${discipline}`

/** A race at `/races/<slug>` with one of these slugs would be shadowed by a landing route. */
export const isReservedRaceSlug = (slug: string): boolean => (Object.values(LANDING_SEGMENTS) as string[]).includes(slug)

const withPage = (path: string, page: number) => (page === 1 ? path : `${path}?page=${page}`)

/**
 * The indexable route for a query, or null when it should be `noindex`. Only the unfiltered calendar and single-facet
 * queries (one state, or one discipline) have landing pages; pagination keeps its own canonical URL.
 */
export const canonicalPathOf = (query: RaceQuery, today: LocalDate): string | null => {
  const filters = serialiseRaceQuery({ ...query, page: 1 }, today)
  const [discipline] = query.disciplines
  if (filters === '') return withPage(RACES_PATH, query.page)
  if (query.subdivision && filters === `state=${query.subdivision}`) return withPage(stateLandingPath(query.subdivision), query.page)
  if (discipline && filters === `discipline=${discipline}`) return withPage(disciplineLandingPath(discipline), query.page)
  return null
}

/** Where a `noindex` view points its canonical link: the landing page it narrows. */
export const nearestLandingPath = (query: RaceQuery): string => {
  const [discipline, ...others] = query.disciplines
  if (query.subdivision) return stateLandingPath(query.subdivision)
  if (discipline && others.length === 0) return disciplineLandingPath(discipline)
  return RACES_PATH
}

/** Internal links go to the landing route when one exists, so crawlers and shared links meet one URL per view. */
export const racesHref = (query: RaceQuery, today: LocalDate): string => {
  const canonical = canonicalPathOf(query, today)
  if (canonical) return canonical
  return `${RACES_PATH}?${serialiseRaceQuery(query, today)}`
}

/** Submitters give raw metres; `category` and `band` are derived, never accepted from a form. */
export type RaceSubmission = Omit<Race, 'id' | 'slug' | 'moderation' | 'lastVerifiedOn' | 'status' | 'source' | 'distances'> & {
  distances: NonEmpty<Omit<RaceDistanceOption, 'category' | 'band'>>
  submitter: Submitter
}
type FieldErrors = Readonly<Record<string, string>>
type FieldResult<T> = Result<T, string>
type Collected<R> = { [K in keyof R]: R[K] extends FieldResult<infer T> ? T : never }

const collect = <R extends Record<string, FieldResult<unknown>>>(fields: R): Result<Collected<R>, FieldErrors> => {
  const values: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const [key, result] of Object.entries(fields)) {
    if (result.ok) values[key] = result.value
    else errors[key] = result.error
  }
  return Object.keys(errors).length > 0 ? err(errors) : ok(values as Collected<R>)
}

const textBetween = (raw: string, min: number, max: number, label: string): FieldResult<string> => {
  const length = Array.from(raw).length
  if (length === 0 && min > 0) return err(`Enter ${label}.`)
  return length >= min && length <= max ? ok(raw) : err(`Use ${min} to ${max} characters for ${label}.`)
}

const HTTPS_URL = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:[/?#]\S*)?$/
const httpsUrl = (raw: string): FieldResult<HttpsUrl> =>
  HTTPS_URL.test(raw) && raw.length <= 2048 ? ok(raw as HttpsUrl) : err('Enter a full link starting with https://.')

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const email = (raw: string): FieldResult<Email> =>
  EMAIL.test(raw) && raw.length <= 254 ? ok(raw as Email) : err('Enter an email address such as name@example.com.')

const localDate = (raw: string): FieldResult<LocalDate> => {
  const parsed = parseLocalDate(raw)
  return parsed.ok ? parsed : err('Enter a real date as YYYY-MM-DD.')
}

const optional = <T>(raw: string, parse: (raw: string) => FieldResult<T>): FieldResult<T | null> =>
  raw === '' ? ok(null) : parse(raw)

const dayCount = (raw: string): FieldResult<number> => {
  const days = /^\d{1,2}$/.test(raw) ? Number(raw) : 0
  return days >= 1 && days <= 30 ? ok(days) : err('Enter a number of days from 1 to 30.')
}

const discipline = (raw: string): FieldResult<Discipline> => {
  const known = knownIn(DISCIPLINES, [raw])[0]
  return known ? ok(known) : err('Choose a discipline.')
}

const distances = (raw: unknown): FieldResult<NonEmpty<{ metres: Metres }>> => {
  const entries = listOf(raw)
  if (entries.some((e) => !/^\d{1,7}$/.test(e) || Number(e) === 0)) return err('Enter each distance in whole metres, such as 21097.')
  const [first, ...rest] = entries.map((e) => ({ metres: Number(e) as Metres }))
  return first ? ok([first, ...rest]) : err('Add at least one distance.')
}

const timeZone = (raw: string): FieldResult<string> => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: raw })
    return ok(raw)
  } catch {
    return err('Enter an IANA time zone such as Asia/Kolkata.')
  }
}

const subdivision = (raw: string): FieldResult<Subdivision> => {
  const parsed = parseSubdivision(raw)
  return parsed ? ok(parsed) : err('Enter a state code such as IN-TS.')
}

const location = (field: (key: string) => string): Result<RaceLocation, FieldErrors> => {
  if (['1', 'on'].includes(field('virtual'))) return ok({ kind: 'virtual' })
  const place = collect({
    venue: textBetween(field('venue'), 1, 120, 'the venue'),
    city: textBetween(field('city'), 1, 80, 'the city'),
    state: subdivision(field('state')),
  })
  if (!place.ok) return place
  const { venue, city, state } = place.value
  return ok({ kind: 'venue', venue, city, subdivision: state, country: 'IN' })
}

const mergeErrors = (...results: Result<unknown, FieldErrors>[]): FieldErrors =>
  Object.assign({}, ...results.map((r) => (r.ok ? {} : r.error)))

/**
 * Takes plain fields, not `FormData`, so the same parser serves the web form and a future mobile client.
 * Each field is a string or string array; for single-valued fields the first value is used, trimmed.
 * Errors are keyed by field name.
 *
 * Required: `name` (3 to 120 characters), `discipline`, `start` (`YYYY-MM-DD`), `distances` (whole metres,
 * repeated or comma-separated), `officialUrl` (https), `submitterName` (1 to 120), `submitterEmail`.
 * Location: `virtual` (`1` or `on`) for a virtual race; otherwise `venue`, `city`, and `state` (ISO 3166-2 such as
 * `IN-TS`).
 * Optional: `dayCount` (1 to 30, default 1), `timeZone` (IANA, default `Asia/Kolkata`), `registrationUrl` (https,
 * default `officialUrl`), `registrationClosesOn` (`YYYY-MM-DD`), `summary` (up to 1000 characters).
 */
export const parseRaceSubmission = (
  input: Readonly<Record<string, unknown>>,
): Result<RaceSubmission, Readonly<Record<string, string>>> => {
  const field = (key: string) => firstOf(input[key])

  const common = collect({
    name: textBetween(field('name'), 3, 120, 'the race name'),
    discipline: discipline(field('discipline')),
    start: localDate(field('start')),
    dayCount: field('dayCount') === '' ? ok(1) : dayCount(field('dayCount')),
    timeZone: field('timeZone') === '' ? ok('Asia/Kolkata') : timeZone(field('timeZone')),
    distances: distances(input.distances),
    officialUrl: httpsUrl(field('officialUrl')),
    registrationUrl: optional(field('registrationUrl'), httpsUrl),
    registrationClosesOn: optional(field('registrationClosesOn'), localDate),
    summary: textBetween(field('summary'), 0, 1000, 'the summary'),
    submitterName: textBetween(field('submitterName'), 1, 120, 'your name'),
    submitterEmail: email(field('submitterEmail')),
  })

  const place = location(field)

  if (!common.ok || !place.ok) return err(mergeErrors(common, place))
  const f = common.value
  return ok({
    name: f.name,
    discipline: f.discipline,
    dates: { start: f.start, dayCount: f.dayCount },
    timeZone: f.timeZone,
    location: place.value,
    distances: f.distances,
    officialUrl: f.officialUrl,
    registration: { url: f.registrationUrl ?? f.officialUrl, closesOn: f.registrationClosesOn },
    summary: f.summary,
    submitter: { name: f.submitterName, email: f.submitterEmail },
  })
}

const eventDates = (race: PublicRace) => ({
  start: race.dates.start,
  endExclusive: addDays(race.dates.start, race.dates.dayCount),
})

const compactDate = (date: LocalDate): string => date.replaceAll('-', '')

const locationText = (location: RaceLocation): string =>
  location.kind === 'virtual' ? 'Virtual' : [location.venue, location.city].filter((part) => part !== '').join(', ')

const icsText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')

const utf8Octets = (codePoint: number): number => (codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4)

/** RFC 5545 caps a line at 75 octets; each continuation line spends one of them on its leading space. */
const foldLine = (line: string): string => {
  const segments: string[] = []
  let current = ''
  let octets = 0
  for (const char of line) {
    const size = utf8Octets(char.codePointAt(0) ?? 0)
    const limit = segments.length === 0 ? 75 : 74
    if (octets + size > limit) {
      segments.push(current)
      current = ''
      octets = 0
    }
    current += char
    octets += size
  }
  segments.push(current)
  return segments.join('\r\n ')
}

/** RFC 5545 all-day event(s); deterministic UID per race so re-importing updates rather than duplicates. */
export const toIcs = (race: PublicRace): string => {
  const { start, endExclusive } = eventDates(race)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ERC//Race calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:race-${race.id}@erc`,
    `DTSTAMP:${compactDate(race.lastVerifiedOn)}T000000Z`,
    `DTSTART;VALUE=DATE:${compactDate(start)}`,
    `DTEND;VALUE=DATE:${compactDate(endExclusive)}`,
    `SUMMARY:${icsText(race.name)}`,
    ...(race.summary === '' ? [] : [`DESCRIPTION:${icsText(race.summary)}`]),
    `LOCATION:${icsText(locationText(race.location))}`,
    `URL:${race.officialUrl}`,
    ...(race.status.kind === 'cancelled' ? ['STATUS:CANCELLED'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

export const googleCalendarUrl = (race: PublicRace): HttpsUrl => {
  const { start, endExclusive } = eventDates(race)
  const details = [race.summary, race.officialUrl].filter((part) => part !== '').join('\n\n')
  const params: [string, string][] = [
    ['action', 'TEMPLATE'],
    ['text', race.name],
    ['dates', `${compactDate(start)}/${compactDate(endExclusive)}`],
    ['details', details],
    ['location', locationText(race.location)],
  ]
  return `https://calendar.google.com/calendar/render?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}` as HttpsUrl
}
