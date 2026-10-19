import {
  addDays,
  DISTANCE_CATEGORIES,
  subdivisionOf,
  type Discipline,
  type DistanceBand,
  type LocalDate,
  type PublicRace,
  type RaceDistanceOption,
  type RaceSource,
  type Seconds,
} from '@erc/domain'

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  road: 'Road',
  trail: 'Trail',
  mountain: 'Mountain',
  skyrunning: 'Skyrunning',
  'cross-country': 'Cross country',
  track: 'Track',
  virtual: 'Virtual',
  community: 'Community',
}

export const BAND_LABELS: Record<DistanceBand, string> = {
  'under-10k': 'Under 10K',
  '10k-to-half': '10K to half',
  'half-to-marathon': 'Half to marathon',
  'marathon-to-60k': 'Marathon to 60K',
  '60k-to-100k': '60K to 100K',
  'over-100k': 'Over 100K',
}

const TERRAIN_LABELS: Record<NonNullable<RaceDistanceOption['terrain']>, string> = {
  road: 'Road',
  trail: 'Trail',
  mixed: 'Mixed',
  track: 'Track',
}

// A LocalDate is a calendar fact, so it is formatted at UTC midnight to keep the day from shifting.
const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const formatDate = (date: LocalDate) => dateFormat.format(new Date(`${date}T00:00:00Z`))

const datePartsFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const dateParts = (date: LocalDate) => {
  const parts = datePartsFormat.formatToParts(new Date(`${date}T00:00:00Z`))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { weekday: part('weekday'), day: part('day'), month: part('month') }
}

export const formatDates =({ start, dayCount }: PublicRace['dates']) =>
  dayCount === 1 ? formatDate(start) : `${formatDate(start)} to ${formatDate(addDays(start, dayCount - 1))} (${dayCount} days)`

const namedCategories = new Map<string, string>(DISTANCE_CATEGORIES.map(({ key, label }) => [key, label]))

export const formatDistance = (option: RaceDistanceOption) => {
  const named = namedCategories.get(option.category)
  const km = `${Number((option.metres / 1000).toFixed(1))} km`
  return named && !named.endsWith('K') ? `${named} (${km})` : km
}

export const formatCutoff = (seconds: Seconds) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${hours} h ${String(minutes).padStart(2, '0')} min`
}

export const terrainLabel = (terrain: NonNullable<RaceDistanceOption['terrain']>) => TERRAIN_LABELS[terrain]

export const placeOf = (race: PublicRace) =>
  race.location.kind === 'virtual' ? 'Virtual' : `${race.location.city}, ${subdivisionOf(race.location.subdivision).name}`

/** Coach-knowledge sources never name the staff member who confirmed them. */
export const sourceLabel = (source: RaceSource): { text: string; url: string | null } => {
  switch (source.kind) {
    case 'organiser':
      return { text: "The organiser's website", url: source.url }
    case 'listing-site':
      return { text: source.name, url: source.url }
    case 'runner-submission':
      return { text: 'A runner submission', url: null }
    case 'coach-knowledge':
      return { text: 'ERC coaches', url: null }
  }
}
