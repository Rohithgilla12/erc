import type { CountedRun, PublicSource } from './activities'
import { collect, firstOf, type FieldErrors, type FieldResult } from './form-fields'
import type { MemberId, RawInput } from './members'
import {
  err,
  ok,
  type Id,
  type Instant,
  type LocalDate,
  type Metres,
  type Result,
  type Seconds,
} from './primitives'

export type CoachId = Id<'coaches'>

export const COACHING_LINK_STATES = ['requested', 'active', 'ended'] as const
export type CoachingLinkState = (typeof COACHING_LINK_STATES)[number]

export type CoachingDecision = 'accept' | 'reject'

export type CoachingLinkEndedBy = 'athlete' | 'coach' | 'staff'

export type CoachingLink = {
  id: string
  athleteMember: MemberId
  coachId: CoachId
  state: CoachingLinkState
  requestedAt: Instant
  decidedAt: Instant | null
  endedAt: Instant | null
  endedBy: CoachingLinkEndedBy | null
}

export const CHECK_IN_FEELINGS = ['great', 'good', 'tired', 'struggling', 'injured'] as const
export type CheckInFeeling = (typeof CHECK_IN_FEELINGS)[number]

export type AthleteCheckIn = {
  feeling: CheckInFeeling
  niggles: string | null
  note: string | null
  submittedAt?: Instant | string
}

export const WATCH_FLAGS = [
  'VOLUME_SPIKE',
  'NO_REST_DAY',
  'LONG_RUN_HEAVY',
  'ELEVATED_FATIGUE',
  'NIGGLE_REPORTED',
  'MISSED_LOGS',
] as const
export type WatchFlag = (typeof WATCH_FLAGS)[number]

export type WeeklySummary = {
  totalMetres: Metres
  totalSeconds: Seconds
  runCount: number
  longestRunMetres: Metres
  previousWeekMetres: Metres | null
  volumeChangePct: number | null
  flags: readonly WatchFlag[]
  suggestedWatch: readonly string[]
  suggestedRecos: readonly string[]
}

export type WeekReviewInput = {
  watch: readonly string[]
  recommendations: readonly string[]
  note: string | null
}

export type WeekReview = WeekReviewInput & {
  linkId: string
  weekStartDate: LocalDate | string
  sharedAt: Instant | string
}

export const decideLink = (state: CoachingLinkState, decision: CoachingDecision): CoachingLinkState | null => {
  if (state === 'requested') {
    return decision === 'accept' ? 'active' : 'ended'
  }
  return null
}

export const endLink = (state: CoachingLinkState): CoachingLinkState | null => {
  if (state === 'active') {
    return 'ended'
  }
  return null
}

export const parseCheckIn = (fields: RawInput): Result<AthleteCheckIn, FieldErrors> => {
  const feelingRaw = firstOf(fields.feeling) as CheckInFeeling
  const feelingResult: FieldResult<CheckInFeeling> = CHECK_IN_FEELINGS.includes(feelingRaw)
    ? ok(feelingRaw)
    : err('Select how you felt this week.')

  const nigglesRaw = firstOf(fields.niggles)
  const nigglesResult: FieldResult<string | null> =
    nigglesRaw === ''
      ? ok(null)
      : Array.from(nigglesRaw).length <= 280
        ? ok(nigglesRaw)
        : err('Keep niggles under 280 characters.')

  const noteRaw = firstOf(fields.note)
  const noteResult: FieldResult<string | null> =
    noteRaw === ''
      ? ok(null)
      : Array.from(noteRaw).length <= 1000
        ? ok(noteRaw)
        : err('Keep note under 1000 characters.')

  return collect({
    feeling: feelingResult,
    niggles: nigglesResult,
    note: noteResult,
  })
}

const parseListField = (raw: unknown, label: string): FieldResult<readonly string[]> => {
  let items: string[] = []
  if (Array.isArray(raw)) {
    items = raw.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '')
  } else if (typeof raw === 'string') {
    items = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  } else if (raw === null || raw === undefined || raw === '') {
    items = []
  } else {
    return err(`Enter a valid list of ${label}.`)
  }

  if (items.length > 10) {
    return err(`Enter at most 10 ${label}.`)
  }
  for (const item of items) {
    if (Array.from(item).length > 200) {
      return err(`Each ${label.endsWith('s') ? label.slice(0, -1) : label} must be 200 characters or fewer.`)
    }
  }
  return ok(items)
}

export const parseWeekReview = (fields: RawInput): Result<WeekReviewInput, FieldErrors> => {
  const noteRaw = firstOf(fields.note)
  const noteResult: FieldResult<string | null> =
    noteRaw === ''
      ? ok(null)
      : Array.from(noteRaw).length <= 1000
        ? ok(noteRaw)
        : err('Keep coach note under 1000 characters.')

  return collect({
    watch: parseListField(fields.watch, 'watch items'),
    recommendations: parseListField(fields.recommendations ?? fields.recos, 'recommendations'),
    note: noteResult,
  })
}

type RunLike = {
  metres?: Metres | number
  distance?: Metres | number
  seconds?: Seconds | number
  moving?: Seconds | number
  date?: LocalDate | string
  on?: LocalDate | string
}

const metresOf = (r: RunLike): number => {
  const n = Number(r.metres ?? r.distance ?? 0)
  return Number.isFinite(n) ? n : 0
}
const secondsOf = (r: RunLike): number => {
  const n = Number(r.seconds ?? r.moving ?? 0)
  return Number.isFinite(n) ? n : 0
}
const dateOf = (r: RunLike): string => {
  const raw = String(r.date ?? r.on ?? '').trim()
  return raw.includes('T') ? (raw.split('T')[0] ?? '') : raw.slice(0, 10)
}

export const summariseWeek = (
  thisWeek: readonly (CountedRun<PublicSource> | RunLike)[],
  lastWeek?: readonly (CountedRun<PublicSource> | RunLike)[] | null,
  checkIn?: AthleteCheckIn | null,
): WeeklySummary => {
  const totalMetres = thisWeek.reduce((sum, r) => sum + metresOf(r), 0) as Metres
  const totalSeconds = thisWeek.reduce((sum, r) => sum + secondsOf(r), 0) as Seconds
  const runCount = thisWeek.length
  const longestRunMetres = (thisWeek.length > 0 ? Math.max(...thisWeek.map(metresOf)) : 0) as Metres

  let previousWeekMetres: Metres | null = null
  let volumeChangePct: number | null = null

  if (lastWeek && lastWeek.length > 0) {
    const prevTotal = lastWeek.reduce((sum, r) => sum + metresOf(r), 0)
    previousWeekMetres = prevTotal as Metres
    if (prevTotal > 0) {
      volumeChangePct = Math.round(((totalMetres - prevTotal) / prevTotal) * 100)
    }
  }

  const flags: WatchFlag[] = []
  const suggestedWatch: string[] = []
  const suggestedRecos: string[] = []

  if (thisWeek.length === 0) {
    flags.push('MISSED_LOGS')
    suggestedWatch.push('No runs logged this week.')
    suggestedRecos.push('Check in with athlete on health and recovery.')
  }

  if (volumeChangePct !== null && volumeChangePct > 10) {
    flags.push('VOLUME_SPIKE')
    suggestedWatch.push(`Monitor adaptation after a ${volumeChangePct}% volume increase; do not increase mileage next week.`)
  }

  const uniqueDays = new Set(thisWeek.map(dateOf).filter((d) => d.length > 0)).size
  if (uniqueDays >= 7) {
    flags.push('NO_REST_DAY')
    suggestedWatch.push('Ran all 7 days this week without a rest day.')
    suggestedRecos.push('Schedule at least one complete rest day next week.')
  }

  if (totalMetres > 0 && longestRunMetres / totalMetres > 0.4) {
    flags.push('LONG_RUN_HEAVY')
    suggestedWatch.push('Long run exceeded 40% of weekly volume.')
    suggestedRecos.push('Keep long run under 40% of weekly volume.')
  }

  if (checkIn) {
    if (checkIn.feeling === 'tired' || checkIn.feeling === 'struggling') {
      flags.push('ELEVATED_FATIGUE')
      suggestedRecos.push('Prioritize 8+ hrs sleep and keep mid-week easy runs strictly Zone 1/2.')
    }

    if (checkIn.niggles && checkIn.niggles.trim().length > 0) {
      flags.push('NIGGLE_REPORTED')
      suggestedWatch.push(`Check ${checkIn.niggles.trim()} on warm-up; abort if pain exceeds 3/10.`)
    }
  }

  return {
    totalMetres,
    totalSeconds,
    runCount,
    longestRunMetres,
    previousWeekMetres,
    volumeChangePct,
    flags,
    suggestedWatch,
    suggestedRecos,
  }
}
