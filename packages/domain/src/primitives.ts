export const notImplemented = (): never => {
  throw new Error('not implemented')
}

declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type Slug = Brand<string, 'Slug'>
/** Calendar date with no time zone, `YYYY-MM-DD`. Race days are local facts; a timestamp would shift them across midnight. */
export type LocalDate = Brand<string, 'LocalDate'>
export type Instant = Brand<string, 'Instant'>
export type Metres = Brand<number, 'Metres'>
export type Seconds = Brand<number, 'Seconds'>
export type Paise = Brand<number, 'Paise'>
export type HttpsUrl = Brand<string, 'HttpsUrl'>
export type Email = Brand<string, 'Email'>
/** The 11-character id, never a full URL. Thumbnails and embeds are derived from it. */
export type YouTubeId = Brand<string, 'YouTubeId'>
export type NonEmpty<T> = readonly [T, ...T[]]

/** Entity id, branded per entity so a race id cannot be passed where an athlete id is expected. */
export type Id<E extends string> = Brand<number, `Id:${E}`>

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value })
export const err = <E>(error: E): { ok: false; error: E } => ({ ok: false, error })

const MS_PER_DAY = 86_400_000

// setUTCFullYear, unlike Date.UTC, does not remap years 0-99 to 1900-1999.
const utcMidnight = (year: number, month: number, day: number): Date => {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

const formatUtcDate = (date: Date): LocalDate =>
  `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}` as LocalDate

const toUtcMidnight = (date: LocalDate): Date => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  return utcMidnight(year, month, day)
}

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const shifted = toUtcMidnight(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return formatUtcDate(shifted)
}

export const daysBetween = (from: LocalDate, to: LocalDate): number =>
  Math.round((toUtcMidnight(to).getTime() - toUtcMidnight(from).getTime()) / MS_PER_DAY)

export const parseLocalDate = (raw: string): Result<LocalDate, 'not_a_date'> => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) return err('not_a_date')
  const [, year, month, day] = match.map(Number) as [number, number, number, number]
  const date = utcMidnight(year, month, day)
  const rolledOver = date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  return rolledOver ? err('not_a_date') : ok(raw as LocalDate)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (raw: string): boolean => UUID.test(raw)

/** Lower-case words joined by single hyphens, so a slug is safe in a URL path, a filename, and a quoted header. */
export const parseSlug = (raw: string): Result<Slug, 'not_a_slug'> =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) ? ok(raw as Slug) : err('not_a_slug')

// Payload's email field validator, copied so that an address this accepts is one the CMS will store.
const EMAIL =
  /^(?!.*\.\.)[\w!#$%&'*+/=?^`{|}~-](?:[\w!#$%&'*+/=?^`{|}~.-]*[\w!#$%&'*+/=?^`{|}~-])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i

export const parseEmail = (raw: string): Result<Email, 'not_an_email'> => (EMAIL.test(raw) && raw.length <= 254 ? ok(raw as Email) : err('not_an_email'))

const YOUTUBE_ID = '[A-Za-z0-9_-]{11}'
const YOUTUBE_PATTERNS = [
  new RegExp(`^(${YOUTUBE_ID})$`),
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.)?youtube\\.com/watch\\?(?:[^#]*&)?v=(${YOUTUBE_ID})(?:[&#].*)?$`),
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.)?youtube\\.com/(?:embed|shorts)/(${YOUTUBE_ID})(?:[/?#].*)?$`),
  new RegExp(`^(?:https?://)?youtu\\.be/(${YOUTUBE_ID})(?:[?#].*)?$`),
]

export const parseYouTubeId = (urlOrId: string): Result<YouTubeId, 'not_youtube'> => {
  const trimmed = urlOrId.trim()
  for (const pattern of YOUTUBE_PATTERNS) {
    const id = pattern.exec(trimmed)?.[1]
    if (id) return ok(id as YouTubeId)
  }
  return err('not_youtube')
}

export const todayIn = (timeZone: 'Asia/Kolkata', now: Date = new Date()): LocalDate => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}` as LocalDate
}
