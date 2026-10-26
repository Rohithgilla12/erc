import { collect, firstOf, optional, textBetween, type FieldErrors, type FieldResult } from './form-fields'
import { MIN_MEMBER_AGE, type RawInput } from './members'
import type { Moderation } from './moderation'
import { err, ok, type Id, type LocalDate, type Result, type Slug } from './primitives'
import { parseSubdivision, type Subdivision } from './subdivisions'

export type Visibility = 'public' | 'hidden'
export const VISIBILITY_KEYS = ['profile', 'results', 'mileage'] as const
export type VisibilityKey = (typeof VISIBILITY_KEYS)[number]
/** Consent to show each part of a profile. Everything starts hidden, and once a member is linked only they change it. */
export type AthleteVisibility = Record<VisibilityKey, Visibility>

/** Staff's switch, separate from consent: a withheld athlete is left off every leaderboard whatever they chose. */
export type LeaderboardStanding = 'included' | 'withheld'

export type MediaId = Id<'media'>

/** Every field a member may set on their athlete profile. */
export type ProfileValues = {
  name: string
  bio: string
  photo: MediaId | null
  city: string | null
  state: Subdivision
  runningSince: number | null
  birthYear: number | null
}
export type ProfileField = keyof ProfileValues

/**
 * `direct` changes at once. `reviewed` changes at once until the profile is approved; after that a change that adds
 * something public waits for staff, and the live profile keeps its value meanwhile. `private` changes at once and is
 * never shown to anyone but the member.
 */
export type ProfileRule = 'direct' | 'reviewed' | 'private'

type TextSpec<K extends ProfileField> = {
  rule: ProfileRule
  input: 'text'
  label: string
  parse: (raw: string, today: LocalDate) => FieldResult<ProfileValues[K]>
}
type UploadSpec = { rule: ProfileRule; input: 'upload'; label: string }

const yearOf = (today: LocalDate) => Number(today.slice(0, 4))

const year =
  (min: (today: LocalDate) => number, max: (today: LocalDate) => number, message: (min: number, max: number) => string) =>
  (raw: string, today: LocalDate): FieldResult<number | null> =>
    optional(raw, (text) => {
      const value = Number(text)
      const [low, high] = [min(today), max(today)]
      return /^\d{4}$/.test(text) && value >= low && value <= high ? ok(value) : err(message(low, high))
    })

/**
 * The one table of who may change what. The collection's field access and every member parser are built from it, so
 * the admin and the API cannot disagree about a field.
 */
export const PROFILE_FIELDS = {
  name: { rule: 'reviewed', input: 'text', label: 'Name', parse: (raw) => textBetween(raw.replace(/\s+/g, ' '), 1, 80, 'your name') },
  bio: { rule: 'reviewed', input: 'text', label: 'About you', parse: (raw) => textBetween(raw, 0, 400, 'the text about you') },
  photo: { rule: 'reviewed', input: 'upload', label: 'Photo' },
  city: { rule: 'direct', input: 'text', label: 'City', parse: (raw) => optional(raw.replace(/\s+/g, ' '), (text) => textBetween(text, 1, 80, 'your city')) },
  state: {
    rule: 'direct',
    input: 'text',
    label: 'State',
    parse: (raw) => {
      const code = parseSubdivision(raw)
      return code ? ok(code) : err('Choose your state or union territory.')
    },
  },
  runningSince: {
    rule: 'direct',
    input: 'text',
    label: 'Running since',
    parse: year(() => 1950, yearOf, (low, high) => `Enter a year from ${low} to ${high}.`),
  },
  birthYear: {
    rule: 'private',
    input: 'text',
    label: 'Year of birth',
    parse: year(() => 1920, (today) => yearOf(today) - MIN_MEMBER_AGE, (low, high) => `Enter a year from ${low} to ${high}. Members are ${MIN_MEMBER_AGE} or over.`),
  },
} as const satisfies { [K in ProfileField]: TextSpec<K> | UploadSpec }

type Fields = typeof PROFILE_FIELDS
export type FieldsRuled<R extends ProfileRule> = { [K in ProfileField]: Fields[K]['rule'] extends R ? K : never }[ProfileField]
export type ReviewedField = FieldsRuled<'reviewed'>
/** Fields a member types; the photo arrives as an upload through its own operation. */
export type TextProfileField = { [K in ProfileField]: Fields[K]['input'] extends 'text' ? K : never }[ProfileField]

export const PROFILE_FIELD_NAMES = Object.keys(PROFILE_FIELDS) as readonly ProfileField[]
const TEXT_FIELDS = PROFILE_FIELD_NAMES.filter((key): key is TextProfileField => PROFILE_FIELDS[key].input === 'text')

export const ruleOf = (field: ProfileField): ProfileRule => PROFILE_FIELDS[field].rule

export type ProfileEdit = Partial<Pick<ProfileValues, TextProfileField>>
export type NewProfile = Pick<ProfileValues, TextProfileField>

// A JSON client may send a year as a number, and `null` to clear a field.
const textOf = (raw: unknown): string => (typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : firstOf(raw))

const parseField = <K extends TextProfileField>(key: K, raw: unknown, today: LocalDate): FieldResult<ProfileValues[K]> =>
  (PROFILE_FIELDS[key] as TextSpec<K>).parse(textOf(raw), today)

/** Only the fields the input names are changed; a field it leaves out keeps its value. Unknown keys are ignored. */
export const parseProfileEdit = (raw: RawInput, today: LocalDate): Result<ProfileEdit, FieldErrors> => {
  const present = TEXT_FIELDS.filter((key) => raw[key] !== undefined)
  return collect(Object.fromEntries(present.map((key) => [key, parseField(key, raw[key], today)]))) as Result<ProfileEdit, FieldErrors>
}

/** A new profile needs a name and a state; every other field may be left empty. */
export const parseNewProfile = (raw: RawInput, today: LocalDate): Result<NewProfile, FieldErrors> =>
  collect(Object.fromEntries(TEXT_FIELDS.map((key) => [key, parseField(key, raw[key], today)]))) as Result<NewProfile, FieldErrors>

/** A reviewed change always adds something public: a removal never waits for review. */
export type ReviewedChange = { field: 'name'; value: string } | { field: 'bio'; value: string } | { field: 'photo'; value: MediaId }

/** What an edit does: values written now, changes sent for review, and pending changes withdrawn. */
export type EditPlan = { apply: Partial<ProfileValues>; propose: readonly ReviewedChange[]; withdraw: readonly ReviewedField[] }

const isReviewed = (field: ProfileField): field is ReviewedField => ruleOf(field) === 'reviewed'

/**
 * Routes each changed field by its rule. Before the profile is approved nothing is public, so every field applies at
 * once. Once it is approved, a reviewed field that gains new words or a new picture becomes a change for staff; one
 * that is emptied applies at once, because hiding never waits. Setting a reviewed field back to its live value
 * withdraws the change waiting for it.
 */
export const planProfileEdit = (approved: boolean, live: ProfileValues, edit: Partial<ProfileValues>): EditPlan => {
  const apply: Partial<Record<ProfileField, unknown>> = {}
  const propose: ReviewedChange[] = []
  const withdraw: ReviewedField[] = []
  for (const field of PROFILE_FIELD_NAMES) {
    if (!(field in edit)) continue
    const value = edit[field]
    const reviewed = approved && isReviewed(field)
    if (value === live[field]) {
      if (reviewed) withdraw.push(field)
      continue
    }
    if (reviewed && value !== null && value !== '') {
      propose.push({ field, value } as ReviewedChange)
      continue
    }
    apply[field] = value
    if (reviewed) withdraw.push(field)
  }
  return { apply: apply as Partial<ProfileValues>, propose, withdraw }
}

/** Where a member stands with athlete profiles. A member has at most one, counting a claim waiting for review. */
export type AthleteStanding = { kind: 'none' } | { kind: 'claim_pending' } | { kind: 'profile'; moderation: Moderation['state'] }

export type LinkRefusal = 'claim_pending' | 'has_profile'

/**
 * Whether the member may claim a profile or start one. A profile they started that staff rejected is replaced, so a
 * rejection is not a dead end; any other profile, or a claim still open, refuses.
 */
export const planLink = (standing: AthleteStanding): Result<{ replaceRejected: boolean }, LinkRefusal> => {
  switch (standing.kind) {
    case 'none':
      return ok({ replaceRejected: false })
    case 'claim_pending':
      return err('claim_pending')
    case 'profile':
      return standing.moderation === 'rejected' ? ok({ replaceRejected: true }) : err('has_profile')
  }
}

/** The profile a claim names, as the shell found it. */
export type ClaimTarget = { moderation: Moderation['state']; linked: boolean; openClaim: boolean } | null

export type ClaimRefusal = 'not_claimable' | 'claim_open'

/** Only an approved profile with no member can be claimed, and only while nobody else's claim on it is open. */
export const checkClaimTarget = (target: ClaimTarget): Result<true, ClaimRefusal> => {
  if (!target || target.moderation !== 'approved' || target.linked) return err('not_claimable')
  return target.openClaim ? err('claim_open') : ok(true)
}

export type ClaimRequest = { athlete: Id<'athletes'>; note: string }

export const parseClaim = (raw: RawInput): Result<ClaimRequest, FieldErrors> => {
  const id = textOf(raw.athlete)
  return collect({
    athlete: /^[1-9]\d{0,9}$/.test(id) ? ok(Number(id) as Id<'athletes'>) : err('Choose a profile from the search.'),
    note: textBetween(firstOf(raw.note), 1, 500, 'a note for the coach'),
  })
}

export const SEARCH_MIN_LENGTH = 3
export const SEARCH_LIMIT = 10
/** Searches one member may run in an hour: plenty to find a profile, far too few to list every hidden name. */
export const SEARCHES_PER_HOUR = 30

/** A name search for claiming. Three letters at least, so the list of profiles cannot be read off one letter at a time. */
export const parseAthleteSearch = (raw: RawInput): Result<{ q: string }, FieldErrors> => {
  const q = firstOf(raw.q).replace(/\s+/g, ' ')
  return Array.from(q).length >= SEARCH_MIN_LENGTH && q.length <= 80
    ? ok({ q })
    : err({ q: `Type at least ${SEARCH_MIN_LENGTH} letters of the name on your profile.` })
}

export type VisibilityEdit = Partial<AthleteVisibility>

const visibilityOf = (raw: unknown): FieldResult<Visibility> => {
  const value = textOf(raw)
  return value === 'public' || value === 'hidden' ? ok(value) : err('Choose public or hidden.')
}

export const parseVisibilityEdit = (raw: RawInput): Result<VisibilityEdit, FieldErrors> => {
  const present = VISIBILITY_KEYS.filter((key) => raw[key] !== undefined)
  if (present.length === 0) return err({ profile: 'Choose what to show.' })
  return collect(Object.fromEntries(present.map((key) => [key, visibilityOf(raw[key])]))) as Result<VisibilityEdit, FieldErrors>
}

/** An uploaded file as a form post or a multipart body carries it. Only the shape the parser needs, so no DOM types. */
export type UploadedFile = { readonly size: number; readonly type: string; arrayBuffer(): Promise<ArrayBuffer> }

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

const isUpload = (raw: unknown): raw is UploadedFile =>
  typeof raw === 'object' &&
  raw !== null &&
  typeof (raw as UploadedFile).size === 'number' &&
  typeof (raw as UploadedFile).type === 'string' &&
  typeof (raw as UploadedFile).arrayBuffer === 'function'

/** A new photo, or `null` to take the current one off. `photo=none` asks for removal, since a form cannot send null. */
export const parsePhoto = (raw: RawInput): Result<{ photo: UploadedFile | null }, FieldErrors> => {
  if (raw.photo === 'none') return ok({ photo: null })
  const file = raw.photo
  if (!isUpload(file) || file.size === 0) return err({ photo: 'Choose a photo to upload.' })
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) return err({ photo: 'Upload a JPEG, PNG or WebP image.' })
  return file.size > PHOTO_MAX_BYTES ? err({ photo: `Upload an image under ${PHOTO_MAX_BYTES / 1024 / 1024} MB.` }) : ok({ photo: file })
}

/** A URL slug from a name: accents dropped, anything else that is not a letter or digit joined by hyphens. */
export const slugFromName = (name: string): Slug => {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return (words || 'athlete') as Slug
}

/** The first of `base`, `base-2`, `base-3`, ... that is not taken. */
export const freeSlug = (base: Slug, taken: ReadonlySet<string>): Slug => {
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate as Slug
  }
}
