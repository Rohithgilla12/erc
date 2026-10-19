import type { Moderation } from './moderation'
import { notImplemented, type HttpsUrl, type Id, type LocalDate, type Metres, type Seconds, type Slug } from './primitives'
import type { DistanceCategory } from './running'

export type Athlete = {
  id: Id<'athletes'>
  slug: Slug
  name: string
  photoUrl: HttpsUrl | null
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

/** Derived from approved results. PBs and ultra finishes are never stored, so they cannot drift. */
export type Achievements = {
  bests: Partial<Record<DistanceCategory, { time: Seconds; result: Id<'results'>; verified: boolean }>>
  ultraFinishes: readonly { category: DistanceCategory; eventName: string; date: LocalDate }[]
}

export const deriveAchievements = (results: readonly RaceResult[]): Achievements => notImplemented()
