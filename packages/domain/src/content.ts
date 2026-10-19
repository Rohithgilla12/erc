import type { VideoCategory } from './learn'
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

export type ContentRef =
  | { kind: 'post'; slug: Slug }
  | { kind: 'video'; slug: Slug }
  | { kind: 'trainingPlan'; slug: Slug }
  | { kind: 'race'; slug: Slug }

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

/** Phase 1 ships only `free`. Phase 3 adds `paid`; `canAccess` is already the single gate. */
export type AccessTier = { kind: 'free' }
export type Viewer = { kind: 'anonymous' }

export type PlanSession = {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7
  title: string
  distance: Metres | null
  duration: Seconds | null
  intensity: 'easy' | 'steady' | 'tempo' | 'intervals' | 'long' | 'strength' | 'rest'
  notes: string
}

/** Plan length is `weeks.length`; it is never stored separately. */
export type TrainingPlan = Published & {
  kind: 'trainingPlan'
  title: string
  goal: DistanceCategory
  level: 'beginner' | 'intermediate' | 'advanced'
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

export const canAccess = (viewer: Viewer, access: AccessTier): boolean => true
