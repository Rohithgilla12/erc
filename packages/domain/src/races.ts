import type { Moderation, Submitter } from './moderation'
import {
  notImplemented,
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
import type { Discipline, DistanceBand, DistanceCategory } from './running'

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
export const isVerificationStale = (race: Pick<Race, 'lastVerifiedOn'>, today: LocalDate): boolean => notImplemented()

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

/** Boundary parser for URL query params. Unknown values are dropped, never thrown on. */
export const parseRaceQuery = (params: QueryParams, today: LocalDate): RaceQuery => notImplemented()
/** Inverse of `parseRaceQuery`. Returns a query string without `?`, omitting defaults, so links stay short and shareable. */
export const serialiseRaceQuery = (query: RaceQuery, today: LocalDate): string => notImplemented()

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
