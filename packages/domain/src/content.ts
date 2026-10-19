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

export type Topic = { id: Id<'topics'>; slug: Slug; title: string }
export type CoachProfile = { id: Id<'coaches'>; slug: Slug; name: string; credentials: string; photoUrl: HttpsUrl | null }
export type Reference = { title: string; url: HttpsUrl; publisher: string | null }
export type Seo = { title: string; description: string; imageUrl: HttpsUrl | null; noindex: boolean }

/** Lexical JSON from the CMS. Opaque here; each client brings its own renderer. */
export type RichText = Brand<unknown, 'RichText'>

type Published = { slug: Slug; publishedAt: Instant; updatedAt: Instant; seo: Seo }

export type ContentRef =
  | { kind: 'post'; slug: Slug }
  | { kind: 'video'; slug: Slug }
  | { kind: 'trainingPlan'; slug: Slug }
  | { kind: 'race'; slug: Slug }

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
