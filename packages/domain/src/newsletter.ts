import { err, parseEmail, type Email, type Instant, type Result } from './primitives'

export const SUBSCRIBER_STATUSES = ['pending', 'confirmed', 'unsubscribed'] as const
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number]

export const SIGNUP_SOURCES = ['site-footer'] as const
export type SignupSource = (typeof SIGNUP_SOURCES)[number]

/** How long a confirmation link works. */
export const CONFIRM_LINK_TTL_MS = 48 * 60 * 60 * 1000

/** A pending address gets at most one confirmation email in this window, however often the form is sent for it. */
export const CONFIRM_RESEND_AFTER_MS = 15 * 60 * 1000

/**
 * Lower-cased, so one person is one subscriber however they type their address. Takes the raw field value, a string
 * or a string array whose first value is used.
 */
export const parseSubscriberEmail = (raw: unknown): Result<Email, string> => {
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = parseEmail(typeof value === 'string' ? value.trim().toLowerCase() : '')
  return parsed.ok ? parsed : err('Enter an email address such as name@example.com.')
}

/** What a signup request finds stored for its address. `consentedAt` is when a confirmation email last went out. */
export type StoredSubscriber = { status: SubscriberStatus; consentedAt: Instant }

/**
 * What a signup request does. `create` and `reissue` store a fresh confirmation link and email it; `none` changes
 * nothing. The visitor sees the same reply in every case, so the form never reveals whether an address is listed.
 */
export type SignupStep = 'create' | 'reissue' | 'none'

export const planSignup = (stored: StoredSubscriber | null, now: Date): SignupStep => {
  if (!stored) return 'create'
  switch (stored.status) {
    case 'confirmed':
      return 'none'
    case 'unsubscribed':
      return 'reissue'
    case 'pending':
      return now.getTime() - Date.parse(stored.consentedAt) < CONFIRM_RESEND_AFTER_MS ? 'none' : 'reissue'
  }
}

/**
 * A confirmation link is found by its hash, which confirming clears, so a used link finds nothing and reads as
 * `unknown`, the same as a link that never existed.
 */
export type ConfirmLinkState = 'valid' | 'expired' | 'unknown'

export const confirmLinkState = (found: { confirmExpiresAt: Instant } | null, now: Date): ConfirmLinkState => {
  if (!found) return 'unknown'
  return Date.parse(found.confirmExpiresAt) > now.getTime() ? 'valid' : 'expired'
}

export const confirmExpiryFrom = (now: Date): Instant => new Date(now.getTime() + CONFIRM_LINK_TTL_MS).toISOString() as Instant
