// ERC Phase 1 type sketch: Payload CMS 3.x inside a Next.js app, Postgres. Companion to 20261019-erc-phase-1-design.md.
// Superseded for domain types by packages/domain; still the reference for the CMS and data-access signatures until they exist in apps/web.
// Module paths in the `@module` tags show where each block lives in the app.
// Bodies throw on purpose; this file is a contract, not an implementation.

const notImplemented = (): never => {
  throw new Error('not implemented')
}

declare const brand: unique symbol
type Brand<T, B extends string> = T & { readonly [brand]: B }

/** @module src/lib/primitives.ts */

export type Slug = Brand<string, 'Slug'>
/** Calendar date with no time zone, `YYYY-MM-DD`. Race days are local facts; a timestamptz would shift them across midnight. */
export type LocalDate = Brand<string, 'LocalDate'>
export type Instant = Brand<string, 'Instant'>
export type Metres = Brand<number, 'Metres'>
export type Seconds = Brand<number, 'Seconds'>
export type Paise = Brand<number, 'Paise'>
export type HttpsUrl = Brand<string, 'HttpsUrl'>
export type Email = Brand<string, 'Email'>
/** The 11-character id, never a full URL. Thumbnails and embeds are derived from it. */
export type YouTubeId = Brand<string, 'YouTubeId'>
/** ISO 3166-2 code such as `IN-TS` or `IN-AP`. Drives the `/races/in/<state>` landing pages. */
export type Subdivision = Brand<string, 'Subdivision'>
export type NonEmpty<T> = readonly [T, ...T[]]

export type Id<C extends CollectionSlug> = Brand<number, `Id:${C}`>

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const parseLocalDate = (raw: string): Result<LocalDate, 'not_a_date'> => notImplemented()
export const parseYouTubeId = (urlOrId: string): Result<YouTubeId, 'not_youtube'> => notImplemented()
export const todayIn = (timeZone: 'Asia/Kolkata', now?: Date): LocalDate => notImplemented()

/** @module src/cms/kinds.ts */

// The two lists below are the only place a collection is classified.
// Access rules, revalidation, and the admin sidebar group are derived from membership.
export const EDITORIAL_SLUGS = [
  'posts',
  'videos',
  'trainingPlans',
  'resources',
  'pages',
  'coaches',
  'topics',
] as const
export const RECORD_SLUGS = ['races', 'athletes', 'results', 'subscribers', 'enquiries', 'media', 'staff'] as const

export type EditorialSlug = (typeof EDITORIAL_SLUGS)[number]
export type RecordSlug = (typeof RECORD_SLUGS)[number]
export type CollectionSlug = EditorialSlug | RecordSlug

export type StaffRole = 'admin' | 'editor' | 'author'
export type Actor = { kind: 'anonymous' } | { kind: 'staff'; id: Id<'staff'>; role: StaffRole }

/**
 * A collection built by `defineEditorial` or `defineRecord`. `buildErcConfig` accepts only these,
 * so a raw Payload `CollectionConfig` cannot reach the config and skip the visibility rule.
 */
export type ErcCollection =
  | { readonly kind: 'editorial'; readonly slug: EditorialSlug; readonly payload: unknown }
  | { readonly kind: 'record'; readonly slug: RecordSlug; readonly payload: unknown }

export type EditorialSpec<D> = {
  slug: EditorialSlug
  /** Public URL of a published doc, or null for docs with no page of their own (topics). */
  route: (doc: D) => string | null
  fields: readonly unknown[]
}

export type RecordSpec<D> = {
  slug: RecordSlug
  route: (doc: D) => string | null
  /** `public-submissions` lets anonymous visitors create rows in the `submitted` state and nothing else. */
  intake: 'staff-only' | 'public-submissions' | 'system-only'
  fields: readonly unknown[]
}

/** Adds drafts, versions, autosave, scheduled publish, the review workflow, SEO fields, and tag revalidation. */
export const defineEditorial = <D>(spec: EditorialSpec<D>): ErcCollection => notImplemented()
/** Adds the moderation group, anonymous read limited to approved rows, and tag revalidation. No rich-text body. */
export const defineRecord = <D>(spec: RecordSpec<D>): ErcCollection => notImplemented()
export const buildErcConfig = (collections: readonly ErcCollection[]): Promise<unknown> => notImplemented()

/** @module src/cms/workflow.ts */

export type EditorialState =
  | { kind: 'draft' }
  | { kind: 'in_review'; submittedBy: Id<'staff'>; at: Instant }
  | { kind: 'changes_requested'; by: Id<'staff'>; note: string; at: Instant }
  | { kind: 'scheduled'; publishAt: Instant; by: Id<'staff'> }
  | { kind: 'published'; at: Instant; by: Id<'staff'> }

export type WorkflowAction =
  | { kind: 'submit' }
  | { kind: 'request_changes'; note: string }
  | { kind: 'publish' }
  | { kind: 'schedule'; publishAt: Instant }
  | { kind: 'unpublish' }

export type WorkflowRefusal =
  | { kind: 'role_cannot'; role: StaffRole; action: WorkflowAction['kind'] }
  | { kind: 'invalid_from'; from: EditorialState['kind']; action: WorkflowAction['kind'] }
  | { kind: 'schedule_in_past' }

/**
 * Pure. The stored `workflow` field is the only owner of editorial state. The `beforeChange` hook calls this,
 * writes the result, and sets Payload's `_status` from it (`published` iff kind is `published`), so the two never disagree.
 * Authors can only `submit`; editors and admins can do everything.
 * Re-applying the same action to the state it produced returns that state unchanged.
 */
export const payloadStatusOf = (state: EditorialState): 'draft' | 'published' => notImplemented()
export const transition = (
  state: EditorialState,
  action: WorkflowAction,
  actor: { id: Id<'staff'>; role: StaffRole },
  now: Instant,
): Result<EditorialState, WorkflowRefusal> => notImplemented()

/** @module src/cms/moderation.ts */

// One moderation model for every public intake: race submissions (Phase 1), profile claims and results (Phase 2).
export type Submitter = { name: string; email: Email }
export type Moderation =
  | { state: 'submitted'; submitter: Submitter | { staff: Id<'staff'> }; at: Instant }
  | { state: 'approved'; by: Id<'staff'>; at: Instant }
  | { state: 'rejected'; by: Id<'staff'>; at: Instant; reason: string }

export type ModerationDecision = { kind: 'approve' } | { kind: 'reject'; reason: string }
export const decide = (
  current: Moderation,
  decision: ModerationDecision,
  by: Id<'staff'>,
  now: Instant,
): Result<Moderation, 'already_decided'> => notImplemented()

/** @module src/domain/running.ts */

export const DISCIPLINES = ['road', 'trail', 'mountain', 'skyrunning', 'cross-country', 'track', 'virtual', 'community'] as const
export type Discipline = (typeof DISCIPLINES)[number]

/**
 * The single list of distance buckets. Filters, landing pages, leaderboard columns and PB slots read from it.
 * `metres` bounds are inclusive; a race option belongs to the first bucket whose range contains it.
 */
export const DISTANCE_CATEGORIES = [
  { key: '5k', label: '5K', min: 4_900, max: 5_100 },
  { key: '10k', label: '10K', min: 9_800, max: 10_200 },
  { key: 'half', label: 'Half marathon', min: 21_000, max: 21_200 },
  { key: 'marathon', label: 'Marathon', min: 42_100, max: 42_300 },
  { key: 'ultra-50k', label: '50K', min: 45_000, max: 60_000 },
  { key: 'ultra-50mi', label: '50 miles', min: 75_000, max: 85_000 },
  { key: 'ultra-100k', label: '100K', min: 95_000, max: 110_000 },
  { key: 'ultra-100mi', label: '100 miles', min: 155_000, max: 175_000 },
] as const
export type DistanceCategory = (typeof DISTANCE_CATEGORIES)[number]['key'] | 'ultra-multiday' | 'other'

/**
 * Exhaustive bands for the calendar filter. Categories are PB slots and leave trail distances such as 25K or 35K
 * in `other`; bands give every option a filterable home.
 */
export const DISTANCE_BANDS = [
  { key: 'under-10k', maxExclusive: 9_800 },
  { key: '10k-to-half', maxExclusive: 21_000 },
  { key: 'half-to-marathon', maxExclusive: 42_100 },
  { key: 'marathon-to-60k', maxExclusive: 60_001 },
  { key: '60k-to-100k', maxExclusive: 110_001 },
  { key: 'over-100k', maxExclusive: Number.POSITIVE_INFINITY },
] as const
export type DistanceBand = (typeof DISTANCE_BANDS)[number]['key']

export const categoriseDistance = (metres: Metres, multiDay: boolean): DistanceCategory => notImplemented()
export const bandOf = (metres: Metres): DistanceBand => notImplemented()

/** @module src/domain/races.ts */

export type RaceLocation =
  | { kind: 'venue'; venue: string; city: string; subdivision: Subdivision; country: 'IN' | (string & {}) }
  | { kind: 'virtual' }

export type RaceDistanceOption = {
  metres: Metres
  /** Stored, not derived at read time, so the calendar filter is an indexed equality, not a range scan per bucket. Written only by the `beforeChange` hook from `metres`. */
  category: DistanceCategory
  band: DistanceBand
  elevationGainMetres?: Metres
  terrain?: 'road' | 'trail' | 'mixed' | 'track'
  cutoff?: Seconds
}

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
  /** Postponed and cancelled races stay listed with a badge, so a runner who saved the link learns what happened. */
  status: { kind: 'scheduled' } | { kind: 'postponed'; newStart: LocalDate | null } | { kind: 'cancelled' }
  /** Where the details came from, shown on the page. Re-checking a race bumps `lastVerifiedOn` and nothing else. */
  source:
    | { kind: 'organiser'; url: HttpsUrl }
    | { kind: 'listing-site'; name: string; url: HttpsUrl }
    | { kind: 'runner-submission' }
    | { kind: 'coach-knowledge'; confirmedBy: Id<'staff'> }
  lastVerifiedOn: LocalDate
  summary: string
  moderation: Moderation
}

export type PublicRace = Race & { moderation: { state: 'approved' } }

/** Derived at render from `lastVerifiedOn`, never stored. Drives the "not recently checked" badge and the editor's stale list. */
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

/** Boundary parser for `searchParams`. Unknown values are dropped, never thrown on. */
export const parseRaceQuery = (
  params: Record<string, string | string[] | undefined>,
  today: LocalDate,
): RaceQuery => notImplemented()
/** Inverse of `parseRaceQuery`, so filter chips are plain links and any view can be shared on WhatsApp. */
export const serialiseRaceQuery = (query: RaceQuery, today: LocalDate): URLSearchParams => notImplemented()

export const findRaces = (query: RaceQuery): Promise<RacePage> => notImplemented()
export const getRace = (slug: Slug): Promise<PublicRace | null> => notImplemented()

/** Submitters give raw metres; `category` and `band` are derived by the hook, never accepted from a form. */
export type RaceSubmission = Omit<Race, 'id' | 'slug' | 'moderation' | 'lastVerifiedOn' | 'status' | 'source' | 'distances'> & {
  distances: NonEmpty<Omit<RaceDistanceOption, 'category' | 'band'>>
  submitter: Submitter
}
export const parseRaceSubmission = (form: FormData): Result<RaceSubmission, Record<string, string>> => notImplemented()
/** Creates a `submitted` race. A repeat submission with the same name and start date returns the existing id. */
export const submitRace = (submission: RaceSubmission): Promise<Result<Id<'races'>, 'rate_limited'>> => notImplemented()

/** RFC 5545 all-day event(s); deterministic UID per race so re-importing updates rather than duplicates. */
export const toIcs = (race: PublicRace): string => notImplemented()
export const googleCalendarUrl = (race: PublicRace): HttpsUrl => notImplemented()

/** @module src/domain/athletes.ts */

export type Athlete = {
  id: Id<'athletes'>
  slug: Slug
  name: string
  photo: Id<'media'> | null
  bio: string
  /** Phase 2 sets this when a member's claim on the profile is approved. Phase 1 rows keep it null. */
  member: null
  visibility: { profile: 'public' | 'hidden'; results: 'public' | 'hidden' }
}

export type ResultProvenance =
  | { kind: 'official'; timingUrl: HttpsUrl | null }
  | { kind: 'self_reported'; evidenceUrl: HttpsUrl | null }

export type RaceResult = {
  id: Id<'results'>
  athlete: Id<'athletes'>
  race: Id<'races'> | null
  eventName: string
  date: LocalDate
  distance: Metres
  category: DistanceCategory
  time: Seconds
  provenance: ResultProvenance
  moderation: Moderation
}

/** Derived per request from approved results. PBs and ultra finishes are never stored, so they cannot drift. */
export type Achievements = {
  bests: Partial<Record<DistanceCategory, { time: Seconds; result: Id<'results'>; verified: boolean }>>
  ultraFinishes: readonly { category: DistanceCategory; eventName: string; date: LocalDate }[]
}
export const deriveAchievements = (results: readonly RaceResult[]): Achievements => notImplemented()
export const getAthleteProfile = (slug: Slug): Promise<{ athlete: Athlete; achievements: Achievements } | null> =>
  notImplemented()

/** @module src/domain/editorial.ts (view models returned by the content read layer) */

export type Topic = { id: Id<'topics'>; slug: Slug; title: string }
export type CoachProfile = { id: Id<'coaches'>; slug: Slug; name: string; credentials: string; photo: Id<'media'> | null }
export type Reference = { title: string; url: HttpsUrl; publisher: string | null }
export type Seo = { title: string; description: string; image: Id<'media'> | null; noindex: boolean }

/** Payload Lexical JSON. Opaque to the site; only the RichText renderer reads it. */
export type RichText = Brand<unknown, 'RichText'>

type Published = { slug: Slug; publishedAt: Instant; updatedAt: Instant; seo: Seo }

export type Post = Published & {
  kind: 'post'
  title: string
  topics: NonEmpty<Topic>
  authors: NonEmpty<CoachProfile>
  body: RichText
  references: readonly Reference[]
  related: readonly ContentRef[]
}

export type Video = Published & {
  kind: 'video'
  title: string
  youtubeId: YouTubeId
  duration: Seconds
  description: RichText
  transcript: RichText | null
  topics: NonEmpty<Topic>
  related: readonly ContentRef[]
}

/** Phase 1 ships only `free`. Phase 3 adds the `paid` variant; the download route already asks `canAccess`. */
export type AccessTier = { kind: 'free' }

export type PlanSession = {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7
  title: string
  distance: Metres | null
  duration: Seconds | null
  intensity: 'easy' | 'steady' | 'tempo' | 'intervals' | 'long' | 'strength' | 'rest'
  notes: string
}

export type TrainingPlan = Published & {
  kind: 'trainingPlan'
  title: string
  goal: DistanceCategory
  level: 'beginner' | 'intermediate' | 'advanced'
  /** Plan length is `weeks.length`; it is never stored separately. */
  prerequisites: string
  audience: string
  weeks: NonEmpty<{ week: number; focus: string; sessions: readonly PlanSession[] }>
  overview: RichText
  coaches: NonEmpty<CoachProfile>
  access: AccessTier
  pdf: Id<'resources'> | null
}

export type DownloadableResource = Published & {
  kind: 'resource'
  title: string
  description: string
  file: { key: string; mimeType: string; bytes: number }
  access: AccessTier
}

export type Page = Published & { kind: 'page'; title: string; layout: readonly unknown[] }

export type ContentRef =
  | { kind: 'post'; slug: Slug }
  | { kind: 'video'; slug: Slug }
  | { kind: 'trainingPlan'; slug: Slug }
  | { kind: 'race'; slug: Slug }

/** @module src/content/read.ts (the only module site routes may use to read the CMS) */

export type ReadMode = { draft: false } | { draft: true; actor: Extract<Actor, { kind: 'staff' }> }

export const getPost = (slug: Slug, mode?: ReadMode): Promise<Post | null> => notImplemented()
export const listPosts = (filter: { topic?: Slug; page: number }): Promise<{ items: readonly Post[]; totalPages: number }> =>
  notImplemented()
export const getVideo = (slug: Slug, mode?: ReadMode): Promise<Video | null> => notImplemented()
export const getTrainingPlan = (slug: Slug, mode?: ReadMode): Promise<TrainingPlan | null> => notImplemented()
export const getPage = (path: string, mode?: ReadMode): Promise<Page | null> => notImplemented()
export const getTopicHub = (
  slug: Slug,
): Promise<{ topic: Topic; posts: readonly Post[]; videos: readonly Video[]; plans: readonly TrainingPlan[] } | null> =>
  notImplemented()

/** @module src/content/cache.ts */

export type CacheTag = Brand<string, 'CacheTag'>
export type DocRef = { collection: CollectionSlug; id: number; slug: Slug | null; topicIds: readonly number[] }

/**
 * The one mapping from a document to the tags its pages depend on.
 * Reads tag their fetches with it; the afterChange and afterDelete hooks revalidate with it.
 */
export const cacheTagsFor = (ref: DocRef): readonly CacheTag[] => notImplemented()

/** @module src/domain/downloads.ts */

export type Viewer = { kind: 'anonymous' }
/** Phase 1 always allows; Phase 3 widens `Viewer` and `AccessTier` and this stays the single gate. */
export const canAccess = (viewer: Viewer, access: AccessTier): boolean => notImplemented()
/** Called only after `canAccess`; the private R2 bucket is never public, so this URL is the only way in. */
export const signedDownloadUrl = (resource: DownloadableResource, ttlSeconds: 300): Promise<HttpsUrl> => notImplemented()

/** @module src/domain/newsletter.ts */

export type Subscriber = {
  id: Id<'subscribers'>
  email: Email
  status:
    | { kind: 'pending'; tokenHash: string; requestedAt: Instant }
    | { kind: 'confirmed'; at: Instant }
    | { kind: 'unsubscribed'; at: Instant }
    | { kind: 'bounced'; at: Instant }
  source: 'footer' | 'post' | 'plan' | 'resource'
}

/** Idempotent; re-subscribing a confirmed address is a no-op that still returns ok. */
export const requestSubscription = (email: Email): Promise<Result<'confirmation_sent' | 'already_confirmed', 'rate_limited'>> =>
  notImplemented()
export const confirmSubscription = (token: string): Promise<Result<'confirmed', 'invalid_or_expired'>> => notImplemented()
/** Phase 1 stops at a confirmed list. Staff export it as CSV; sending issues is a later decision (see design.md). */
export const exportConfirmed = (): Promise<string> => notImplemented()

/** @module src/domain/enquiries.ts */

export type Enquiry = {
  id: Id<'enquiries'>
  topic: 'coaching' | 'general' | 'partnership'
  name: string
  email: Email
  message: string
  receivedAt: Instant
  handled: { kind: 'open' } | { kind: 'handled'; by: Id<'staff'>; at: Instant }
}
export const parseEnquiry = (form: FormData): Result<Omit<Enquiry, 'id' | 'receivedAt' | 'handled'>, Record<string, string>> =>
  notImplemented()
/** Stores the row, then queues a staff notification job. Turnstile is checked by the server action before this runs. */
export const submitEnquiry = (enquiry: Omit<Enquiry, 'id' | 'receivedAt' | 'handled'>): Promise<Id<'enquiries'>> => notImplemented()

/** @module src/domain/leaderboards.ts (Phase 2 seam, signatures only) */

export type Leaderboard =
  | { board: 'verified-best'; category: DistanceCategory }
  | { board: 'mileage'; window: { year: number } | { isoWeek: string } | { month: string } }
  | { board: 'consistency'; year: number }
  | { board: 'longest-run'; year: number }

export type LeaderboardRow = { rank: number; athlete: Pick<Athlete, 'slug' | 'name'>; value: Metres | Seconds | number; verified: boolean }
/** Reads SQL views that already exclude hidden athletes. Heart rate is never a board. */
export const getLeaderboard = (board: Leaderboard): Promise<readonly LeaderboardRow[]> => notImplemented()
