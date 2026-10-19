import type { Moderation } from './moderation'
import type { HttpsUrl, Id, LocalDate, Metres, Seconds, Slug } from './primitives'
import { DISTANCE_CATEGORIES, type DistanceCategory } from './running'

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

// Only DISTANCE_CATEGORIES are PB slots; a best time across `other` or multi-day distances compares unlike races.
const PB_SLOTS: ReadonlySet<DistanceCategory> = new Set(DISTANCE_CATEGORIES.map((c) => c.key))

const isOfficial = (r: RaceResult) => r.provenance.kind === 'official'

// Total order, so the best does not depend on the order results arrive in.
const beats = (a: RaceResult, b: RaceResult): boolean => {
  if (a.time !== b.time) return a.time < b.time
  if (isOfficial(a) !== isOfficial(b)) return isOfficial(a)
  if (a.date !== b.date) return a.date < b.date
  return a.id < b.id
}

export const deriveAchievements = (results: readonly RaceResult[]): Achievements => {
  const approved = results.filter((r) => r.moderation.state === 'approved')

  const bestByCategory = new Map<DistanceCategory, RaceResult>()
  for (const r of approved) {
    if (!PB_SLOTS.has(r.category)) continue
    const current = bestByCategory.get(r.category)
    if (!current || beats(r, current)) bestByCategory.set(r.category, r)
  }
  const bests: Achievements['bests'] = {}
  for (const [category, r] of bestByCategory) bests[category] = { time: r.time, result: r.id, verified: isOfficial(r) }

  const ultraFinishes = approved
    .filter((r) => r.category.startsWith('ultra-'))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.id - a.id))
    .map((r) => ({ category: r.category, eventName: r.eventName, date: r.date }))

  return { bests, ultraFinishes }
}
