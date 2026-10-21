import { collect, email as emailField, firstOf, type FieldErrors } from './form-fields'
import { err, ok, type Brand, type Email, type Id, type Instant, type Result } from './primitives'

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
/** Code requests from one network in an hour. */
export const SIGN_IN_CODES_PER_SENDER_PER_HOUR = 10

/** Members are adults. Under-18 data needs verifiable parental consent under India's DPDP Act, which the club cannot run. */
export const MIN_MEMBER_AGE = 18

const CODE = /^\d{6}$/

export const parseSignInCode = (raw: unknown): Result<SignInCode, 'not_a_code'> => {
  const digits = firstOf(raw).replace(/\s+/g, '')
  return CODE.test(digits) ? ok(digits as SignInCode) : err('not_a_code')
}

/** A six-digit code from 32 bits of randomness, zero-padded. */
export const codeFromRandom = (random: number): SignInCode => String(random % 1_000_000).padStart(6, '0') as SignInCode

/** The newest code stored for an address, as the shell reads it. */
export type StoredSignInCode = { sentAt: Instant; expiresAt: Instant; tries: number; consumedAt: Instant | null }

/** What a code request does, decided before any email is spent. `none` means the code sent a moment ago still stands. */
export type CodeRequestStep = 'send' | 'none'

export const planCodeRequest = (latest: StoredSignInCode | null, now: Date): CodeRequestStep => {
  if (!latest || latest.consumedAt !== null) return 'send'
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
  if (!stored || stored.consumedAt !== null) return { kind: 'unknown' }
  if (Date.parse(stored.expiresAt) <= now.getTime()) return { kind: 'expired' }
  if (stored.tries >= SIGN_IN_CODE_MAX_TRIES) return { kind: 'locked' }
  if (matches) return { kind: 'accepted' }
  const triesLeft = SIGN_IN_CODE_MAX_TRIES - stored.tries - 1
  return triesLeft > 0 ? { kind: 'wrong', triesLeft } : { kind: 'locked' }
}

/** Sliding: a session seen within this many days stays alive. */
export const SESSION_IDLE_DAYS = 90
/** `lastSeenAt` is written at most this often, so reads do not become writes. */
export const SESSION_TOUCH_AFTER_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

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

const declaration = (raw: unknown): Result<true, string> =>
  ['on', 'true', '1'].includes(firstOf(raw)) ? ok(true) : err(`Tick the box to confirm you are ${MIN_MEMBER_AGE} or over.`)

export type SignInStart = { email: Email; over18: true }

/**
 * The declaration is asked of everyone, every time, so the form never has to know whether the address already has an
 * account. The shell stores it when the member is created.
 */
export const parseSignInStart = (fields: RawInput): Result<SignInStart, FieldErrors> =>
  collect({ email: lowerEmail(fields.email), over18: declaration(fields.over18) })

export type SignInVerify = { email: Email; code: SignInCode }

export const parseSignInVerify = (fields: RawInput): Result<SignInVerify, FieldErrors> => {
  const code = parseSignInCode(fields.code)
  return collect({ email: lowerEmail(fields.email), code: code.ok ? code : err('Enter the six-digit code from the email.') })
}
