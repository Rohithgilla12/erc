import type { Moderation } from './moderation'
import { err, ok, type HttpsUrl, type Id, type LocalDate, type Metres, type Result, type Seconds, type Slug } from './primitives'
import { categoriseDistance, DISTANCE_CATEGORIES, type DistanceCategory } from './running'
import type { Subdivision } from './subdivisions'

export type Athlete = {
  id: Id<'athletes'>
  slug: Slug
  name: string
  photoUrl: HttpsUrl | null
  bio: string
  home: { city: string | null; subdivision: Subdivision }
  runningSince: number | null
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

const newestFirst = (a: RaceResult, b: RaceResult) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.id - a.id)

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
    .sort(newestFirst)
    .map((r) => ({ category: r.category, eventName: r.eventName, date: r.date }))

  return { bests, ultraFinishes }
}

/** What a public profile may show of an athlete's results: nothing at all until the athlete makes them public. */
export type AthleteRecord =
  | { visibility: 'hidden' }
  | { visibility: 'public'; results: readonly RaceResult[]; achievements: Achievements }

/** Approved results of this athlete only, newest first, with achievements derived from exactly the results listed. */
export const athleteRecordOf = (athlete: Pick<Athlete, 'id' | 'visibility'>, results: readonly RaceResult[]): AthleteRecord => {
  if (athlete.visibility.results === 'hidden') return { visibility: 'hidden' }
  const listed = results.filter((r) => r.athlete === athlete.id && r.moderation.state === 'approved').sort(newestFirst)
  return { visibility: 'public', results: listed, achievements: deriveAchievements(listed) }
}

export type HeadlineBest = { category: DistanceCategory; label: string; time: Seconds; verified: boolean }

/** The `limit` longest PB slots an athlete has a best in, shortest first. Longer distances say more in an endurance club. */
export const headlineBests = (achievements: Achievements, limit = 3): HeadlineBest[] =>
  DISTANCE_CATEGORIES.flatMap(({ key, label }) => {
    const best = achievements.bests[key]
    return best ? [{ category: key, label, time: best.time, verified: best.verified }] : []
  }).slice(-limit)

// Strictly h:mm:ss: "1:30" would be ambiguous between 90 minutes and 90 seconds.
const FINISH_TIME = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/

/** A finish time typed as `h:mm:ss`, such as `0:19:45` or `27:03:10`. */
export const parseFinishTime = (raw: string): Result<Seconds, 'not_a_finish_time'> => {
  const match = FINISH_TIME.exec(raw.trim())
  if (!match) return err('not_a_finish_time')
  const [, hours, minutes, seconds] = match.map(Number) as [number, number, number, number]
  const total = hours * 3600 + minutes * 60 + seconds
  return total > 0 ? ok(total as Seconds) : err('not_a_finish_time')
}

/** The inverse of `parseFinishTime` for whole seconds. */
export const formatFinishTime = (time: Seconds): string => {
  const whole = Math.floor(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(whole / 3600)}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`
}

const MARATHON_MAX = DISTANCE_CATEGORIES.find((c) => c.key === 'marathon')?.max ?? 42_300

/**
 * A result's category. A multi-day race weekend often includes a 10K or a marathon, which are not multi-day ultras,
 * so only a distance beyond the marathon run at a race spanning several days counts as one.
 */
export const categoriseResult = (metres: Metres, raceDays: number): DistanceCategory =>
  categoriseDistance(metres, raceDays > 1 && metres > MARATHON_MAX)
