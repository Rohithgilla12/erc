import { describe, expect, it } from 'vitest'
import {
  CONFIRM_LINK_TTL_MS,
  CONFIRM_LIMIT_WINDOW_MS,
  CONFIRM_RESEND_AFTER_MS,
  confirmationSent,
  confirmExpiryFrom,
  confirmLinkState,
  parseSubscriberEmail,
  planSignup,
  type Instant,
  type StoredSubscriber,
} from './index'

const now = new Date('2026-10-20T06:00:00.000Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString() as Instant
const stored = (status: StoredSubscriber['status'], consentedMsAgo: number, priorMsAgo: number | null = null): StoredSubscriber => ({
  status,
  consentedAt: ago(consentedMsAgo),
  priorConsentedAt: priorMsAgo === null ? null : ago(priorMsAgo),
})
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

describe('parseSubscriberEmail', () => {
  it('trims and lower-cases, so one person is one subscriber', () => {
    expect(parseSubscriberEmail('  Asha.Rao@Example.COM ')).toEqual({ ok: true, value: 'asha.rao@example.com' })
  })

  it('takes the first value of a repeated field', () => {
    expect(parseSubscriberEmail(['a@example.com', 'b@example.com'])).toEqual({ ok: true, value: 'a@example.com' })
  })

  it.each<[unknown, string]>([['', 'empty'], ['asha', 'no domain'], ['asha@example', 'no dot in the domain'], [undefined, 'missing']])(
    'refuses %j (%s)',
    (raw) => {
      expect(parseSubscriberEmail(raw)).toEqual({ ok: false, error: 'Enter an email address such as name@example.com.' })
    },
  )
})

describe('planSignup', () => {
  it('creates a new subscriber for an unknown address', () => {
    expect(planSignup(null, now)).toBe('create')
  })

  it('changes nothing for a confirmed subscriber', () => {
    expect(planSignup(stored('confirmed', 0), now)).toBe('none')
    expect(planSignup(stored('confirmed', 365 * 24 * 60 * 60 * 1000), now)).toBe('none')
  })

  it('does not email a pending address again inside the resend window', () => {
    expect(planSignup(stored('pending', 0), now)).toBe('none')
    expect(planSignup(stored('pending', CONFIRM_RESEND_AFTER_MS - 1), now)).toBe('none')
  })

  it('sends a fresh link to a pending address once the window has passed', () => {
    expect(planSignup(stored('pending', CONFIRM_RESEND_AFTER_MS), now)).toBe('reissue')
  })

  it('asks an unsubscribed address to confirm again rather than resubscribing it silently', () => {
    expect(planSignup(stored('unsubscribed', 0), now)).toBe('reissue')
  })

  it('sends no third confirmation within a day of the earlier of the last two', () => {
    expect(planSignup(stored('pending', HOUR, CONFIRM_LIMIT_WINDOW_MS - 1), now)).toBe('none')
    expect(planSignup(stored('unsubscribed', HOUR, CONFIRM_LIMIT_WINDOW_MS - 1), now)).toBe('none')
    expect(planSignup(stored('pending', HOUR, CONFIRM_LIMIT_WINDOW_MS), now)).toBe('reissue')
    expect(planSignup(stored('unsubscribed', HOUR, CONFIRM_LIMIT_WINDOW_MS), now)).toBe('reissue')
  })
})

describe('confirmationSent', () => {
  it('keeps the previous send as the prior one', () => {
    expect(confirmationSent(null, now)).toEqual({ consentedAt: now.toISOString(), priorConsentedAt: null })
    expect(confirmationSent(stored('unsubscribed', HOUR, 2 * HOUR), now)).toEqual({ consentedAt: now.toISOString(), priorConsentedAt: ago(HOUR) })
  })
})

describe('signups for one address, every five minutes for three days', () => {
  const start = now.getTime()
  const sends: number[] = []
  let row: StoredSubscriber | null = null
  for (let at = start; at < start + 72 * HOUR; at += 5 * MINUTE) {
    const step = planSignup(row, new Date(at))
    if (step === 'none') continue
    sends.push(at - start)
    row = { status: 'pending', ...confirmationSent(row, new Date(at)) }
  }

  it('never mail the address more than twice in any 24 hours', () => {
    const busiest = Math.max(...sends.map((send) => sends.filter((other) => other >= send && other < send + CONFIRM_LIMIT_WINDOW_MS).length))
    expect(busiest).toBe(2)
  })

  it('mail it twice, 15 minutes apart, each time the day comes round', () => {
    expect(sends).toEqual([0, 15 * MINUTE, 24 * HOUR, 24 * HOUR + 15 * MINUTE, 48 * HOUR, 48 * HOUR + 15 * MINUTE])
  })
})

describe('confirmLinkState', () => {
  it('reads a link with no stored match, including one already used, as unknown', () => {
    expect(confirmLinkState(null, now)).toBe('unknown')
  })

  it('accepts a link until its expiry and refuses it from then on', () => {
    const expiresAt = confirmExpiryFrom(now)
    expect(Date.parse(expiresAt) - now.getTime()).toBe(CONFIRM_LINK_TTL_MS)
    expect(confirmLinkState({ confirmExpiresAt: expiresAt }, new Date(Date.parse(expiresAt) - 1))).toBe('valid')
    expect(confirmLinkState({ confirmExpiresAt: expiresAt }, new Date(Date.parse(expiresAt)))).toBe('expired')
  })
})
