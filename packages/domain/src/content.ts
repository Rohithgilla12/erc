import type { ContentKind, VideoCategory } from './learn'
import type {
  Brand,
  HttpsUrl,
  Id,
  Instant,
  Metres,
  NonEmpty,
  Seconds,
  Slug,
  YouTubeId,
} from './primitives'
import type { DistanceCategory } from './running'

export type Topic = { id: Id<'topics'>; slug: Slug; title: string; description: string; order: number }
export type CoachProfile = { id: Id<'coaches'>; slug: Slug; name: string; credentials: string; photoUrl: HttpsUrl | null }
/** A coach's public profile page; lists show the shorter `CoachProfile`. */
export type Coach = CoachProfile & { bio: RichText | null }
export type Reference = { title: string; url: HttpsUrl; publisher: string | null }
export type Seo = { title: string; description: string; imageUrl: HttpsUrl | null; noindex: boolean }
export type CoverImage = { url: HttpsUrl; alt: string; width: number; height: number }

/** Lexical JSON from the CMS. Opaque here; each client brings its own renderer. */
export type RichText = Brand<unknown, 'RichText'>

type Published = { slug: Slug; publishedAt: Instant; updatedAt: Instant; seo: Seo }

export type ContentRef = { [K in ContentKind]: { kind: K; slug: Slug } }[ContentKind]

/** A reference resolved far enough to render as a link. */
export type ContentLink = ContentRef & { title: string }

/**
 * Every post is saved with at least one topic and one author, but an unpublished topic or coach drops out of the
 * public copy, so readers can see none.
 */
export type Post = Published & {
  kind: 'post'
  title: string
  excerpt: string
  cover: CoverImage | null
  topics: readonly Topic[]
  authors: readonly CoachProfile[]
  body: RichText
  readingMinutes: number
  references: readonly Reference[]
  related: readonly ContentLink[]
}

export type PostSummary = Pick<Post, 'kind' | 'slug' | 'title' | 'excerpt' | 'cover' | 'topics' | 'authors' | 'publishedAt' | 'readingMinutes'>

export type Video = Published & {
  kind: 'video'
  title: string
  youtubeId: YouTubeId
  duration: Seconds
  category: VideoCategory
  description: RichText
  transcript: RichText | null
  topics: readonly Topic[]
  related: readonly ContentLink[]
}

export type VideoSummary = Pick<Video, 'kind' | 'slug' | 'title' | 'youtubeId' | 'duration' | 'category' | 'publishedAt'>

/**
 * Who may open a plan or a file. Phase 1 ships only `free`. Phase 3 adds a `paid` variant, and every switch over
 * `kind`, `canAccess` first, stops compiling until it handles it.
 */
export type AccessTier = { kind: 'free' }

/** Phase 1 has no member accounts, so every reader is anonymous. */
export type Viewer = { kind: 'anonymous' }
export const ANONYMOUS: Viewer = { kind: 'anonymous' }

/**
 * The one access gate for plans and downloads. Phase 3 changes this policy, never the URLs that call it. `viewer`
 * goes unread until there are members, but callers pass it now so that change touches no call site.
 */
export const canAccess = (viewer: Viewer, access: AccessTier): boolean => {
  switch (access.kind) {
    case 'free':
      return true
  }
}

export const PLAN_LEVELS = ['beginner', 'intermediate', 'advanced'] as const
export type PlanLevel = (typeof PLAN_LEVELS)[number]
export const PLAN_LEVEL_LABELS: Readonly<Record<PlanLevel, string>> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export const SESSION_INTENSITIES = ['easy', 'steady', 'tempo', 'intervals', 'long', 'strength', 'rest'] as const
export type SessionIntensity = (typeof SESSION_INTENSITIES)[number]
export const SESSION_INTENSITY_LABELS: Readonly<Record<SessionIntensity, string>> = {
  easy: 'Easy',
  steady: 'Steady',
  tempo: 'Tempo',
  intervals: 'Intervals',
  long: 'Long run',
  strength: 'Strength',
  rest: 'Rest',
}

export const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type WeekDay = (typeof WEEK_DAYS)[number]

/** A session is measured by distance or by time, never both; rest and strength sessions usually have neither. */
export type SessionTarget = { kind: 'distance'; metres: Metres } | { kind: 'duration'; seconds: Seconds } | { kind: 'none' }

export type PlanSession = {
  day: WeekDay
  title: string
  target: SessionTarget
  intensity: SessionIntensity
  notes: string
}

/** A week's number is its position in `weeks`, so it is never stored. */
export type PlanWeek = { focus: string; sessions: NonEmpty<PlanSession> }

/** Plan length is `weeks.length` (`planWeekCount`); it is never stored separately. */
export type TrainingPlan = Published & {
  kind: 'trainingPlan'
  title: string
  goal: DistanceCategory
  level: PlanLevel
  prerequisites: string
  audience: string
  overview: RichText
  weeks: NonEmpty<PlanWeek>
  strength: RichText | null
  recovery: RichText | null
  /** Published coach profiles only. A plan whose coaches are all unpublished is credited to the club. */
  coaches: readonly CoachProfile[]
  access: AccessTier
  pdf: DownloadableResource | null
}

export const RESOURCE_CATEGORIES = ['plan-pdf', 'checklist', 'guide', 'spreadsheet'] as const
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number]
export const RESOURCE_CATEGORY_LABELS: Readonly<Record<ResourceCategory, string>> = {
  'plan-pdf': 'Plan PDF',
  checklist: 'Checklist',
  guide: 'Guide',
  spreadsheet: 'Spreadsheet',
}

/** Every file type a download may be, keyed by MIME type, with the name a runner knows it by. */
export const RESOURCE_FILE_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.oasis.opendocument.text': 'OpenDocument text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument spreadsheet',
  'text/csv': 'CSV',
} as const satisfies Readonly<Record<string, string>>

export type DownloadableResource = Published & {
  kind: 'resource'
  title: string
  description: string
  category: ResourceCategory
  file: { filename: string; mimeType: string; bytes: number }
  access: AccessTier
}
