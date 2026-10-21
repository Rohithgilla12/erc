import { collect, email as emailField, firstOf, type FieldErrors } from './form-fields'
import { err, isUuid, ok, type Brand, type Email, type Id, type Instant, type Result } from './primitives'

export type MemberId = Id<'members'>

/** A field record from a form post or a JSON body. Every member-facing parser takes this, never FormData. */
export type RawInput = Readonly<Record<string, unknown>>

/**
 * The one list of email purposes and their hourly share of the relay, which allows about 500 messages a day. Phase 1's
 * 15 newsletter confirmations and 5 staff notices an hour already summed to 480 a day, so sign-in codes needed the
 * shares rebalanced, not added. `members.test.ts` holds the sum under `RELAY_DAILY_LIMIT`.
 */
export const EMAIL_SHARES = { enquiry_staff_notice: 3, newsletter_confirmation: 7, sign_in_code: 10 } as const satisfies Record<string, number>
export type EmailPurpose = keyof typeof EMAIL_SHARES
export const RELAY_DAILY_LIMIT = 500

/** Six digits, typed by hand from an email. A code, not a link, so the email can be read on one device and typed on another. */
export type SignInCode = Brand<string, 'SignInCode'>
export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000
export const SIGN_IN_CODE_MAX_TRIES = 5
/** A request inside this window after a code was sent resends nothing; the earlier code still works. */
export const SIGN_IN_CODE_RESEND_AFTER_MS = 60 * 1000
/** Codes to one address in an hour, so the form cannot be used to pester someone. */
export const SIGN_IN_CODES_PER_ADDRESS_PER_HOUR = 3
/** Code requests from one network in an hour. Well under the hourly share, so one network cannot use it all up. */
export const SIGN_IN_CODES_PER_SENDER_PER_HOUR = 3
/**
 * Wrong codes typed for one address in a day, across every code sent to it. Past this the address gets no new code
 * until the window passes, so guessing is bounded per address rather than only per code.
 */
export const SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY = 15

/** Members are adults. Under-18 data needs verifiable parental consent under India's DPDP Act, which the club cannot run. */
export const MIN_MEMBER_AGE = 18

const CODE = /^\d{6}$/

export const parseSignInCode = (raw: unknown): Result<SignInCode, 'not_a_code'> => {
  const digits = firstOf(raw).replace(/\s+/g, '')
  return CODE.test(digits) ? ok(digits as SignInCode) : err('not_a_code')
}

/** A six-digit code from 32 bits of randomness, zero-padded. */
export const codeFromRandom = (random: number): SignInCode => String(random % 1_000_000).padStart(6, '0') as SignInCode

/** The newest code stored for an address, as the shell reads it. A code is closed once it is used or a newer one is sent. */
export type StoredSignInCode = { sentAt: Instant; expiresAt: Instant; tries: number; closedAt: Instant | null }

/** What the shell has counted for this request: codes in the last hour, and wrong tries for the address in the last day. */
export type CodeRequestCounts = { toAddressInHour: number; bySenderInHour: number; failuresForAddressInDay: number }

/**
 * What a code request does, decided before any email is spent. `none` means the code sent a moment ago still stands;
 * the other three are refusals, named for the limit that was hit.
 */
export type CodeRequestStep = 'send' | 'none' | 'per_sender' | 'per_address' | 'too_many_failures'

export const planCodeRequest = (latest: StoredSignInCode | null, counts: CodeRequestCounts, now: Date): CodeRequestStep => {
  if (counts.bySenderInHour >= SIGN_IN_CODES_PER_SENDER_PER_HOUR) return 'per_sender'
  if (counts.toAddressInHour >= SIGN_IN_CODES_PER_ADDRESS_PER_HOUR) return 'per_address'
  if (counts.failuresForAddressInDay >= SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY) return 'too_many_failures'
  if (!latest || latest.closedAt !== null) return 'send'
  const live = Date.parse(latest.expiresAt) > now.getTime() && latest.tries < SIGN_IN_CODE_MAX_TRIES
  return live && now.getTime() - Date.parse(latest.sentAt) < SIGN_IN_CODE_RESEND_AFTER_MS ? 'none' : 'send'
}

export const codeExpiryFrom = (now: Date): Instant => new Date(now.getTime() + SIGN_IN_CODE_TTL_MS).toISOString() as Instant

/**
 * The shell compares hashes in constant time and passes the verdict in; the rule stays pure. `locked` is checked
 * before `matches`, so the fifth wrong try locks the code and a right sixth try is still refused.
 */
export type CodeCheck = { kind: 'accepted' } | { kind: 'wrong'; triesLeft: number } | { kind: 'expired' } | { kind: 'locked' } | { kind: 'unknown' }

export const checkSignInCode = (stored: StoredSignInCode | null, matches: boolean, now: Date): CodeCheck => {
  if (!stored || stored.closedAt !== null) return { kind: 'unknown' }
  if (Date.parse(stored.expiresAt) <= now.getTime()) return { kind: 'expired' }
  if (stored.tries >= SIGN_IN_CODE_MAX_TRIES) return { kind: 'locked' }
  if (matches) return { kind: 'accepted' }
  const triesLeft = SIGN_IN_CODE_MAX_TRIES - stored.tries - 1
  return triesLeft > 0 ? { kind: 'wrong', triesLeft } : { kind: 'locked' }
}

/** How a session token reaches the server. A token is bound to the carrier that issued it, so a cookie never works as a bearer or the reverse. */
export type Carrier = 'cookie' | 'bearer'

/** What a session is listed as on the devices page when the client declares no name. */
export const DEFAULT_DEVICE_LABELS: Readonly<Record<Carrier, string>> = { cookie: 'Web browser', bearer: 'App' }
export const DEVICE_LABEL_MAX = 40
const DEVICE_LABEL = /^[\p{L}\p{N} .'()+-]+$/u

/** A short name an app declares for itself, such as "Asha's phone"; anything unusable falls back to the carrier's label. */
export const deviceLabelOf = (declared: string | null, carrier: Carrier): string => {
  const text = (declared ?? '').replace(/\s+/g, ' ').trim()
  return text !== '' && text.length <= DEVICE_LABEL_MAX && DEVICE_LABEL.test(text) ? text : DEFAULT_DEVICE_LABELS[carrier]
}

/** Sliding: a session seen within this many days stays alive. */
export const SESSION_IDLE_DAYS = 90
/** `lastSeenAt` is written at most this often, so reads do not become writes. */
export const SESSION_TOUCH_AFTER_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * The cookie's own lifetime is the browser's cap of 400 days, so the stored row's `expiresAt`, which slides, is the
 * only thing that decides whether a session is live. A cookie expiry fixed at sign-in would end a session the row kept.
 */
export const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60

export const sessionExpiryFrom = (now: Date): Instant => new Date(now.getTime() + SESSION_IDLE_DAYS * DAY_MS).toISOString() as Instant

export type StoredSession = { expiresAt: Instant; lastSeenAt: Instant; memberStatus: MemberStatus }

export type SessionCheck = 'live' | 'live_touch' | 'expired' | 'suspended'

/** `live_touch` asks the shell to slide the expiry; a session is read far more often than it needs writing. */
export const checkSession = (stored: StoredSession, now: Date): SessionCheck => {
  if (Date.parse(stored.expiresAt) <= now.getTime()) return 'expired'
  if (stored.memberStatus === 'suspended') return 'suspended'
  return now.getTime() - Date.parse(stored.lastSeenAt) >= SESSION_TOUCH_AFTER_MS ? 'live_touch' : 'live'
}

export const MEMBER_STATUSES = ['active', 'suspended'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

const lowerEmail = (raw: unknown) => emailField(firstOf(raw).toLowerCase())

// A form sends `on`; a JSON body sends `true`.
const declaration = (raw: unknown): Result<true, string> =>
  raw === true || ['on', 'true', '1'].includes(firstOf(raw)) ? ok(true) : err(`Tick the box to confirm you are ${MIN_MEMBER_AGE} or over.`)

export type SignInStart = { email: Email; over18: true }

/**
 * The declaration is asked of everyone, every time, so the form never has to know whether the address already has an
 * account. The shell stores it when the member is created.
 */
export const parseSignInStart = (fields: RawInput): Result<SignInStart, FieldErrors> =>
  collect({ email: lowerEmail(fields.email), over18: declaration(fields.over18) })

/** `device` is what an app calls itself; the web form sends none and the shell labels the session by its carrier. */
export type SignInVerify = { email: Email; code: SignInCode; device: string | null }

export const parseSignInVerify = (fields: RawInput): Result<SignInVerify, FieldErrors> => {
  const code = parseSignInCode(fields.code)
  const device = firstOf(fields.device)
  return collect({ email: lowerEmail(fields.email), code: code.ok ? code : err('Enter the six-digit code from the email.'), device: ok(device === '' ? null : device) })
}

export type RevokeSession = { session: string }

/** The session row to end, by id. Which member it belongs to is the shell's to check against the caller. */
export const parseRevokeSession = (fields: RawInput): Result<RevokeSession, FieldErrors> => {
  const session = firstOf(fields.session)
  return collect({ session: isUuid(session) ? ok(session.toLowerCase()) : err('That device is not in your list.') })
}
