import type { ContentRef } from './content'
import { err, ok, type Result, type Seconds } from './primitives'

/** The brief's six video categories, in the order the library shows them. */
export const VIDEO_CATEGORIES = [
  { key: 'technique', label: 'Running technique and beginner guidance' },
  { key: 'coach-explainers', label: 'Coach explainers and training demonstrations' },
  { key: 'strength', label: 'Strength and cross-training' },
  { key: 'race-preparation', label: 'Race preparation and race-day advice' },
  { key: 'group-sessions', label: 'Long runs, hill repeats and group sessions' },
  { key: 'runner-stories', label: 'Runner interviews and race experiences' },
] as const

export type VideoCategory = (typeof VIDEO_CATEGORIES)[number]['key']

export const parseVideoCategory = (raw: string): VideoCategory | null =>
  VIDEO_CATEGORIES.find((category) => category.key === raw)?.key ?? null

export const videoCategoryLabel = (key: VideoCategory): string =>
  VIDEO_CATEGORIES.find((category) => category.key === key)?.label ?? key

const SECTION_OF: Record<ContentRef['kind'], string> = { post: '/learn', video: '/videos', trainingPlan: '/plans', race: '/races' }

export const contentPath = (ref: ContentRef): string => `${SECTION_OF[ref.kind]}/${ref.slug}`

/** A post at `/learn/<slug>` with one of these slugs would be shadowed by a learning-centre route. */
export const isReservedPostSlug = (slug: string): boolean => slug === 'topic'

const WORDS_PER_MINUTE = 200

/** Derived on every read from the body's word count, so it can never disagree with the text. */
export const readingMinutes = (words: number): number => Math.max(1, Math.round(words / WORDS_PER_MINUTE))

const CLOCK = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/

/** `ss`, `m:ss`, or `h:mm:ss`, as an editor reads a video's length off YouTube. */
export const parseClockDuration = (raw: string): Result<Seconds, 'not_a_duration'> => {
  const trimmed = raw.trim()
  if (/^\d{1,5}$/.test(trimmed)) return Number(trimmed) > 0 ? ok(Number(trimmed) as Seconds) : err('not_a_duration')
  const match = CLOCK.exec(trimmed)
  if (!match) return err('not_a_duration')
  const [, hours, minutes = '0', seconds = '0'] = match
  if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) return err('not_a_duration')
  const total = Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds)
  return total > 0 ? ok(total as Seconds) : err('not_a_duration')
}

export const formatClockDuration = (total: Seconds): string => {
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** ISO 8601, as schema.org's `duration` expects: `PT1H2M3S`. */
export const isoDuration = (total: Seconds): string => {
  const parts: [number, string][] = [
    [Math.floor(total / 3600), 'H'],
    [Math.floor((total % 3600) / 60), 'M'],
    [total % 60, 'S'],
  ]
  return `PT${parts.flatMap(([value, unit]) => (value > 0 ? [`${value}${unit}`] : [])).join('') || '0S'}`
}

/** One page of a list that can grow. */
export type ListPage<T> = { items: readonly T[]; total: number; page: number; totalPages: number }

export const MAX_LIST_PAGE = 1000

/** `?page=` as a list reads it: a missing, malformed, or out-of-range value is page 1. */
export const parseListPage = (raw: string | readonly string[] | undefined): number => {
  const value = typeof raw === 'string' ? raw : raw?.[0]
  const page = value && /^\d{1,4}$/.test(value) ? Number(value) : 0
  return page >= 1 && page <= MAX_LIST_PAGE ? page : 1
}

export const withPageParam = (href: string, page: number): string =>
  page === 1 ? href : `${href}${href.includes('?') ? '&' : '?'}page=${page}`
