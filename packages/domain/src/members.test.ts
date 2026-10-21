import { describe, expect, it } from 'vitest'
import {
  checkSession,
  checkSignInCode,
  codeExpiryFrom,
  codeFromRandom,
  deviceLabelOf,
  EMAIL_SHARES,
  parseRevokeSession,
  parseSignInCode,
  parseSignInStart,
  parseSignInVerify,
  planCodeRequest,
  RELAY_DAILY_LIMIT,
  SESSION_COOKIE_MAX_AGE_S,
  SESSION_IDLE_DAYS,
  SESSION_TOUCH_AFTER_MS,
  sessionExpiryFrom,
  SIGN_IN_CODE_MAX_TRIES,
  SIGN_IN_CODE_RESEND_AFTER_MS,
  SIGN_IN_CODE_TTL_MS,
  SIGN_IN_CODES_PER_ADDRESS_PER_HOUR,
  SIGN_IN_CODES_PER_SENDER_PER_HOUR,
  SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY,
  type CodeRequestCounts,
  type Instant,
  type StoredSession,
  type StoredSignInCode,
} from './index'

const now = new Date('2026-10-21T06:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString() as Instant
const ahead = (ms: number) => new Date(now.getTime() + ms).toISOString() as Instant
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const code = (overrides: Partial<StoredSignInCode> = {}): StoredSignInCode => ({
  sentAt: ago(MINUTE),
  expiresAt: ahead(SIGN_IN_CODE_TTL_MS - MINUTE),
  tries: 0,
  closedAt: null,
  ...overrides,
})

describe('EMAIL_SHARES', () => {
  it('spend under the relay limit of about 500 a day even if every form is flooded all day', () => {
    const perHour = Object.values(EMAIL_SHARES).reduce((sum, share) => sum + share, 0)
    expect(perHour * 24).toBeLessThan(RELAY_DAILY_LIMIT)
  })

  it('names every purpose that sends email', () => {
    expect(Object.keys(EMAIL_SHARES).sort()).toEqual(['enquiry_staff_notice', 'newsletter_confirmation', 'sign_in_code'])
  })

  it('lets no single network use up the sign-in share: at least three senders fit in an hour', () => {
    expect(SIGN_IN_CODES_PER_SENDER_PER_HOUR * 3).toBeLessThanOrEqual(EMAIL_SHARES.sign_in_code)
  })
})

describe('parseSignInCode', () => {
  it('accepts six digits, with the spaces people type between groups', () => {
    expect(parseSignInCode('123 456')).toEqual({ ok: true, value: '123456' })
  })

  it.each(['12345', '1234567', 'abcdef', '', ['12345a']])('refuses %j', (raw) => {
    expect(parseSignInCode(raw)).toEqual({ ok: false, error: 'not_a_code' })
  })

  it('pads a small random number to six digits', () => {
    expect(codeFromRandom(42)).toBe('000042')
    expect(codeFromRandom(4_000_000_123)).toBe('000123')
  })
})

describe('planCodeRequest', () => {
  const quiet: CodeRequestCounts = { toAddressInHour: 0, bySenderInHour: 0, failuresForAddressInDay: 0 }

  it('sends when nothing is stored, or the stored code was used', () => {
    expect(planCodeRequest(null, quiet, now)).toBe('send')
    expect(planCodeRequest(code({ closedAt: ago(MINUTE) }), quiet, now)).toBe('send')
  })

  it('resends nothing within a minute of a live code', () => {
    expect(planCodeRequest(code({ sentAt: ago(SIGN_IN_CODE_RESEND_AFTER_MS - 1) }), quiet, now)).toBe('none')
    expect(planCodeRequest(code({ sentAt: ago(SIGN_IN_CODE_RESEND_AFTER_MS) }), quiet, now)).toBe('send')
  })

  it('sends a fresh code at once when the live one is locked or expired', () => {
    expect(planCodeRequest(code({ sentAt: ago(1), tries: SIGN_IN_CODE_MAX_TRIES }), quiet, now)).toBe('send')
    expect(planCodeRequest(code({ sentAt: ago(1), expiresAt: ago(1) }), quiet, now)).toBe('send')
  })

  it('refuses at the hourly limits for the sender and then the address, one under each still sends', () => {
    expect(planCodeRequest(null, { ...quiet, bySenderInHour: SIGN_IN_CODES_PER_SENDER_PER_HOUR }, now)).toBe('per_sender')
    expect(planCodeRequest(null, { ...quiet, bySenderInHour: SIGN_IN_CODES_PER_SENDER_PER_HOUR - 1 }, now)).toBe('send')
    expect(planCodeRequest(null, { ...quiet, toAddressInHour: SIGN_IN_CODES_PER_ADDRESS_PER_HOUR }, now)).toBe('per_address')
    expect(planCodeRequest(null, { ...quiet, toAddressInHour: SIGN_IN_CODES_PER_ADDRESS_PER_HOUR - 1 }, now)).toBe('send')
  })

  it('refuses an address with a day of wrong codes behind it, even once the hourly limits have passed', () => {
    expect(planCodeRequest(null, { ...quiet, failuresForAddressInDay: SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY }, now)).toBe('too_many_failures')
    expect(planCodeRequest(null, { ...quiet, failuresForAddressInDay: SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY - 1 }, now)).toBe('send')
  })

  it('caps guesses per address per day at three locked codes', () => {
    expect(SIGN_IN_FAILURES_PER_ADDRESS_PER_DAY).toBe(3 * SIGN_IN_CODE_MAX_TRIES)
  })

  it('refuses in the order sender, address, failures, so the reply names the wider limit first', () => {
    const all = { toAddressInHour: 99, bySenderInHour: 99, failuresForAddressInDay: 99 }
    expect(planCodeRequest(null, all, now)).toBe('per_sender')
    expect(planCodeRequest(null, { ...all, bySenderInHour: 0 }, now)).toBe('per_address')
  })
})

describe('checkSignInCode', () => {
  it('accepts a matching live code', () => {
    expect(checkSignInCode(code(), true, now)).toEqual({ kind: 'accepted' })
  })

  it('reads a missing or used code as unknown, whatever was typed', () => {
    expect(checkSignInCode(null, true, now)).toEqual({ kind: 'unknown' })
    expect(checkSignInCode(code({ closedAt: ago(1) }), true, now)).toEqual({ kind: 'unknown' })
  })

  it('expires at ten minutes exactly', () => {
    const expiresAt = codeExpiryFrom(now)
    expect(Date.parse(expiresAt) - now.getTime()).toBe(SIGN_IN_CODE_TTL_MS)
    expect(checkSignInCode(code({ expiresAt }), true, new Date(Date.parse(expiresAt) - 1))).toEqual({ kind: 'accepted' })
    expect(checkSignInCode(code({ expiresAt }), true, new Date(Date.parse(expiresAt)))).toEqual({ kind: 'expired' })
  })

  it('counts down the tries and locks on the fifth wrong one, after which even the right code is refused', () => {
    expect(checkSignInCode(code({ tries: 0 }), false, now)).toEqual({ kind: 'wrong', triesLeft: 4 })
    expect(checkSignInCode(code({ tries: 3 }), false, now)).toEqual({ kind: 'wrong', triesLeft: 1 })
    expect(checkSignInCode(code({ tries: 4 }), false, now)).toEqual({ kind: 'locked' })
    expect(checkSignInCode(code({ tries: 5 }), true, now)).toEqual({ kind: 'locked' })
  })
})

describe('checkSession', () => {
  const session = (overrides: Partial<StoredSession> = {}): StoredSession => ({
    expiresAt: ahead(30 * DAY),
    lastSeenAt: ago(MINUTE),
    memberStatus: 'active',
    ...overrides,
  })

  it('slides for 90 days from now', () => {
    expect(Date.parse(sessionExpiryFrom(now)) - now.getTime()).toBe(SESSION_IDLE_DAYS * DAY)
  })

  it('gives the cookie the browser cap of 400 days, longer than any slide, so the row alone decides', () => {
    expect(SESSION_COOKIE_MAX_AGE_S).toBe(400 * 24 * 60 * 60)
    expect(SESSION_COOKIE_MAX_AGE_S * 1000).toBeGreaterThan(SESSION_IDLE_DAYS * DAY)
  })

  it('is live until it expires', () => {
    expect(checkSession(session(), now)).toBe('live')
    expect(checkSession(session({ expiresAt: ago(0) }), now)).toBe('expired')
  })

  it('asks for a touch once a day, not on every read', () => {
    expect(checkSession(session({ lastSeenAt: ago(SESSION_TOUCH_AFTER_MS - 1) }), now)).toBe('live')
    expect(checkSession(session({ lastSeenAt: ago(SESSION_TOUCH_AFTER_MS) }), now)).toBe('live_touch')
  })

  it('refuses a suspended member even with a live session', () => {
    expect(checkSession(session({ memberStatus: 'suspended' }), now)).toBe('suspended')
  })
})

describe('parseSignInStart', () => {
  it('lower-cases the address and needs the age declaration, as a form checkbox or a JSON boolean', () => {
    expect(parseSignInStart({ email: 'Asha@Example.com', over18: 'on' })).toEqual({ ok: true, value: { email: 'asha@example.com', over18: true } })
    expect(parseSignInStart({ email: 'asha@example.com', over18: true })).toEqual({ ok: true, value: { email: 'asha@example.com', over18: true } })
    expect(parseSignInStart({ email: 'asha@example.com', over18: false })).toMatchObject({ ok: false })
  })

  it('refuses a missing declaration with a field error, whatever the address', () => {
    expect(parseSignInStart({ email: 'asha@example.com' })).toEqual({ ok: false, error: { over18: 'Tick the box to confirm you are 18 or over.' } })
  })

  it('refuses a bad address', () => {
    expect(parseSignInStart({ email: 'asha', over18: 'on' })).toEqual({ ok: false, error: { email: 'Enter an email address such as name@example.com.' } })
  })
})

describe('parseSignInVerify', () => {
  it('takes the address and the code, with no device unless one is declared', () => {
    expect(parseSignInVerify({ email: 'asha@example.com', code: '123 456' })).toEqual({ ok: true, value: { email: 'asha@example.com', code: '123456', device: null } })
    expect(parseSignInVerify({ email: 'asha@example.com', code: '123456', device: "Asha's phone" })).toMatchObject({ ok: true, value: { device: "Asha's phone" } })
  })

  it('explains a bad code', () => {
    expect(parseSignInVerify({ email: 'asha@example.com', code: '12' })).toEqual({ ok: false, error: { code: 'Enter the six-digit code from the email.' } })
  })
})

describe('deviceLabelOf', () => {
  it('keeps a short plain name and tidies its spaces', () => {
    expect(deviceLabelOf("  Asha's   phone ", 'bearer')).toBe("Asha's phone")
  })

  it('falls back to the carrier for nothing, markup, or a name over 40 characters', () => {
    expect(deviceLabelOf(null, 'cookie')).toBe('Web browser')
    expect(deviceLabelOf('', 'bearer')).toBe('App')
    expect(deviceLabelOf('<script>alert(1)</script>', 'bearer')).toBe('App')
    expect(deviceLabelOf('x'.repeat(41), 'bearer')).toBe('App')
    expect(deviceLabelOf('x'.repeat(40), 'bearer')).toBe('x'.repeat(40))
  })
})

describe('parseRevokeSession', () => {
  it('takes a session id as a lower-cased UUID and refuses anything else', () => {
    const id = '3F2A1C4E-9B7D-4E1A-8C2B-5D6E7F8A9B0C'
    expect(parseRevokeSession({ session: id })).toEqual({ ok: true, value: { session: id.toLowerCase() } })
    expect(parseRevokeSession({ session: '1 OR 1=1' })).toEqual({ ok: false, error: { session: 'That device is not in your list.' } })
    expect(parseRevokeSession({})).toMatchObject({ ok: false })
  })
})
