import { createHash, randomBytes } from 'node:crypto'

import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  CONFIRM_LIMIT_WINDOW_MS,
  confirmationSent,
  confirmExpiryFrom,
  confirmLinkState,
  parseSubscriberEmail,
  planSignup,
  type ConfirmLinkState,
  type Instant,
} from '@erc/domain'
import { after } from 'next/server'
import { getPayload, type Payload, type PayloadRequest } from 'payload'

import { PRIVACY_NOTICE } from '@/app/(frontend)/site-nav'
import { sendConfirmationEmail } from '@/cms/collections/subscribers'
import { emailConfigured } from '@/cms/email'
import { absoluteUrl } from '@/site-config'

import { withCapLock } from './email-cap'
import { HONEYPOT_FIELD, TOKEN_FIELD } from './form-fields'
import { checkFormToken, issueFormToken, mac, sameMac, senderKeyOf } from './form-guard'

export type SignupRefusal = 'too_fast' | 'expired' | 'rate_limited' | 'unavailable'

/** As with enquiries, `token` travels with every state that shows the form, so a retry keeps the time it was first shown. */
export type SignupFormState =
  | { kind: 'ready'; token: string; email: string }
  | { kind: 'invalid'; token: string; email: string; error: string }
  | { kind: 'refused'; token: string; email: string; reason: SignupRefusal }
  | { kind: 'sent' }

const RATE_WINDOW_MS = 60 * 60 * 1000
export const SIGNUPS_PER_SENDER_PER_HOUR = 5

/**
 * Confirmation emails, site-wide, in any hour. Past it every signup is refused as "try again later", whatever the
 * address, so the refusal says nothing about who is listed and nobody is left waiting for an email that is not coming.
 * Many senders each under their own limit could otherwise mail any number of strangers through the club's relay
 * (about 500 messages a day). Fifteen an hour covers a burst after an announcement, and with
 * `STAFF_EMAILS_PER_HOUR` stays under the relay's day even if both forms are flooded all day.
 */
export const NEWSLETTER_CONFIRMATIONS_PER_HOUR = 15
// Long past the 48-hour link, so an address someone else typed in does not stay on file.
export const UNCONFIRMED_KEPT_MS = 30 * 24 * 60 * 60 * 1000
const PURGE_EVERY_MS = 60 * 60 * 1000

/**
 * The form is offered only when a confirmation email can go out. A signup that can never be confirmed would collect
 * addresses we may not use and leave the visitor waiting for an email that never comes.
 */
export const newsletterOpen = (): boolean => emailConfigured()

export const readySignup = (): SignupFormState => ({ kind: 'ready', token: issueFormToken('newsletter'), email: '' })

// 32 random bytes; only their SHA-256 is stored, so a database leak cannot confirm anyone.
const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{43}$/
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

const unsubscribeTokenFor = (id: number) => `${id}.${mac('newsletter-unsubscribe', String(id))}`

const subscriberIdOf = (token: string): number | null => {
  const [id = '', signature = ''] = token.split('.')
  return /^[1-9]\d{0,9}$/.test(id) && sameMac(signature, mac('newsletter-unsubscribe', id)) ? Number(id) : null
}

const linkTo = (path: string, token: string) => {
  const url = new URL(absoluteUrl(path))
  url.searchParams.set('token', token)
  return url
}

/** Never throws: the signup is stored either way, and the visitor is told the same thing whether or not mail went out. */
async function emailConfirmation(payload: Payload, subscriber: { id: number; email: string }, token: string) {
  try {
    await sendConfirmationEmail(payload, subscriber.email, {
      confirm: linkTo('/newsletter/confirm', token),
      unsubscribe: linkTo('/newsletter/unsubscribe', unsubscribeTokenFor(subscriber.id)),
      privacy: new URL(absoluteUrl(PRIVACY_NOTICE.href)),
    })
  } catch (error) {
    payload.logger.error({ err: error, subscriber: subscriber.id }, 'Could not send a newsletter confirmation email')
  }
}

const findByEmail = async (payload: Payload, email: string, req: Partial<PayloadRequest>) =>
  (await payload.find({ collection: 'subscribers', where: { email: { equals: email } }, limit: 1, depth: 0, pagination: false, req })).docs[0] ?? null

/** A signup that stored a fresh confirmation link, to email once the response is out and the transaction committed. */
type Confirmation = { kind: 'confirm'; subscriber: { id: number; email: string }; confirmToken: string }

/**
 * The public signup. Every accepted request gets the same reply, `sent`, whatever was stored before, so the form never
 * reveals whether an address is listed; the email goes out after the response, so timing does not reveal it either.
 * The rate limit counts the addresses this sender asked for in the last hour, as the enquiry form counts stored
 * enquiries.
 */
export async function receiveSignup(fields: Readonly<Record<string, string>>, headers: Headers): Promise<SignupFormState> {
  const token = fields[TOKEN_FIELD] ?? ''
  const email = fields.email ?? ''
  if (!newsletterOpen()) return { kind: 'refused', token, email, reason: 'unavailable' }
  const payload = await getPayload({ config })

  if ((fields[HONEYPOT_FIELD] ?? '') !== '') {
    payload.logger.warn('Dropped a newsletter signup that filled the hidden field')
    return { kind: 'sent' }
  }

  const parsed = parseSubscriberEmail(email)
  if (!parsed.ok) return { kind: 'invalid', token, email, error: parsed.error }

  const timing = checkFormToken('newsletter', token)
  if (timing === 'too_fast') return { kind: 'refused', token, email, reason: 'too_fast' }
  if (timing === 'expired' || timing === 'invalid') return { kind: 'refused', token: issueFormToken('newsletter'), email, reason: 'expired' }

  const now = new Date()
  const senderKey = senderKeyOf('newsletter', headers)
  // Nothing public reads subscribers, so there is no cached page to expire.
  const context = { skipRevalidation: true }
  try {
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS).toISOString()
    const outcome = await withCapLock(payload, 'newsletter-confirmations', async (req): Promise<SignupFormState | Confirmation> => {
      const { totalDocs } = await payload.count({
        collection: 'subscribers',
        where: { and: [{ senderKey: { equals: senderKey } }, { requestedAt: { greater_than: windowStart } }] },
        req,
      })
      if (totalDocs >= SIGNUPS_PER_SENDER_PER_HOUR) return { kind: 'refused', token, email, reason: 'rate_limited' }

      // A confirmation email is planned exactly when `consentedAt` is set, and the one before moves to
      // `priorConsentedAt`. An address gets at most two a day, so the two columns hold every email of the hour.
      const sentSince = async (field: 'consentedAt' | 'priorConsentedAt') =>
        (await payload.count({ collection: 'subscribers', where: { [field]: { greater_than: windowStart } }, req })).totalDocs
      if ((await sentSince('consentedAt')) + (await sentSince('priorConsentedAt')) >= NEWSLETTER_CONFIRMATIONS_PER_HOUR) {
        payload.logger.warn({ cap: NEWSLETTER_CONFIRMATIONS_PER_HOUR }, 'Refused a newsletter signup: the hourly confirmation email cap is reached')
        return { kind: 'refused', token, email, reason: 'unavailable' }
      }

      const found = await findByEmail(payload, parsed.value, req)
      const stored = found && {
        status: found.status,
        consentedAt: found.consentedAt as Instant,
        priorConsentedAt: (found.priorConsentedAt ?? null) as Instant | null,
      }
      const step = planSignup(stored, now)
      // Every accepted request marks its address, whatever the step, so the limit costs the same for a listed address
      // as for a new one and cannot be used to probe the list.
      const request = { senderKey, requestedAt: now.toISOString() }
      if (step === 'none' && found) {
        await payload.update({ collection: 'subscribers', id: found.id, data: request, context, req })
        return { kind: 'sent' }
      }

      const confirmToken = randomBytes(32).toString('base64url')
      const data = {
        ...request,
        ...confirmationSent(stored, now),
        status: 'pending' as const,
        confirmTokenHash: hashOf(confirmToken),
        confirmExpiresAt: confirmExpiryFrom(now),
      }
      const subscriber = found
        ? await payload.update({ collection: 'subscribers', id: found.id, data, context, req })
        : await payload.create({ collection: 'subscribers', data: { ...data, email: parsed.value, source: 'site-footer' }, context, req })
      return { kind: 'confirm', subscriber, confirmToken }
    })
    if (outcome.kind !== 'confirm') return outcome
    after(() => emailConfirmation(payload, outcome.subscriber, outcome.confirmToken))
  } catch (error) {
    payload.logger.error({ err: error }, 'Could not store a newsletter signup')
    return { kind: 'refused', token, email, reason: 'unavailable' }
  }
  return { kind: 'sent' }
}

const findByConfirmToken = async (payload: Payload, token: string) => {
  if (!CONFIRM_TOKEN.test(token)) return null
  const { docs } = await payload.find({
    collection: 'subscribers',
    where: { confirmTokenHash: { equals: hashOf(token) } },
    limit: 1,
    depth: 0,
    pagination: false,
  })
  const doc = docs[0]
  return doc?.confirmExpiresAt ? { id: doc.id, confirmExpiresAt: doc.confirmExpiresAt as Instant } : null
}

/** For the confirmation page. Reads only: a mail scanner that opens the link must not use it up. */
export async function checkConfirmLink(token: string): Promise<ConfirmLinkState> {
  return confirmLinkState(await findByConfirmToken(await getPayload({ config }), token), new Date())
}

/** Confirms once: it clears the stored hash, so the same link then reads as `unknown`. */
export async function confirmSubscription(token: string): Promise<ConfirmLinkState> {
  const payload = await getPayload({ config })
  const found = await findByConfirmToken(payload, token)
  const state = confirmLinkState(found, new Date())
  if (state !== 'valid') return state
  // One conditional statement, so an unsubscribe or a fresh link that lands after the read above wins instead of
  // being overwritten.
  const { rows } = await payload.db.drizzle.execute(sql`
    UPDATE subscribers
    SET status = 'confirmed', confirmed_at = now(), confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = now()
    WHERE confirm_token_hash = ${hashOf(token)} AND confirm_expires_at > now()
    RETURNING id`)
  return rows.length > 0 ? 'valid' : 'unknown'
}

/** Unsubscribe links are signed rather than stored, so every one we have sent keeps working. */
export const unsubscribeLinkValid = (token: string): boolean => subscriberIdOf(token) !== null

/**
 * Idempotent: unsubscribing twice, or after staff deleted the row, ends in the same place. It also voids any pending
 * confirmation link, so an older email cannot sign the person up again.
 */
export async function unsubscribe(token: string): Promise<boolean> {
  const id = subscriberIdOf(token)
  if (id === null) return false
  const payload = await getPayload({ config })
  await payload.update({
    collection: 'subscribers',
    where: { id: { equals: id } },
    data: { status: 'unsubscribed', confirmTokenHash: null, confirmExpiresAt: null },
    context: { skipRevalidation: true },
  })
  return true
}

/**
 * Deletes unconfirmed signups after 30 days, and unsubscribed addresses once their last confirmation email is a day
 * old, when the daily limit no longer needs the row. Neither row can still count towards the hourly cap.
 */
export async function purgeSubscribers(payload: Payload, now: Date = new Date()) {
  const before = (ms: number) => ({ less_than: new Date(now.getTime() - ms).toISOString() })
  const { docs } = await payload.delete({
    collection: 'subscribers',
    where: {
      or: [
        { and: [{ status: { equals: 'pending' } }, { consentedAt: before(UNCONFIRMED_KEPT_MS) }] },
        { and: [{ status: { equals: 'unsubscribed' } }, { consentedAt: before(CONFIRM_LIMIT_WINDOW_MS) }] },
      ],
    },
    context: { skipRevalidation: true },
  })
  return docs.length
}

/** Called once as the server starts. Purges then and every hour, so retention holds even when nobody signs up. */
export function schedulePurge() {
  const purge = async () => {
    try {
      const payload = await getPayload({ config })
      const deleted = await purgeSubscribers(payload)
      if (deleted > 0) payload.logger.info({ deleted }, 'Deleted expired newsletter signups')
    } catch (error) {
      console.error('Could not delete expired newsletter signups', error)
    }
  }
  void purge()
  setInterval(purge, PURGE_EVERY_MS).unref()
}
