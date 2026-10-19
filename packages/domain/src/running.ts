import { notImplemented, type Metres } from './primitives'

export const DISCIPLINES = ['road', 'trail', 'mountain', 'skyrunning', 'cross-country', 'track', 'virtual', 'community'] as const
export type Discipline = (typeof DISCIPLINES)[number]

/**
 * The single list of PB slots. Leaderboard columns and personal bests read from it.
 * `metres` bounds are inclusive; a distance belongs to the first category whose range contains it.
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
 * Exhaustive bands for the calendar filter. Categories leave trail distances such as 25K or 35K
 * in `other`; bands give every distance a filterable home.
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
