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
/** ISO 3166-2 code such as `IN-TG` or `IN-AP`. Drives the `/races/in/<state>` landing pages. */
export type Subdivision = Brand<string, 'Subdivision'>
export type NonEmpty<T> = readonly [T, ...T[]]

/** Entity id, branded per entity so a race id cannot be passed where an athlete id is expected. */
export type Id<E extends string> = Brand<number, `Id:${E}`>

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export const parseLocalDate = (raw: string): Result<LocalDate, 'not_a_date'> => notImplemented()
export const parseYouTubeId = (urlOrId: string): Result<YouTubeId, 'not_youtube'> => notImplemented()
export const todayIn = (timeZone: 'Asia/Kolkata', now?: Date): LocalDate => notImplemented()
