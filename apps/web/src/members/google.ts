import { randomBytes } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { IssuedSession } from '@erc/contract'
import { err, ok, parseEmail, type Email, type Instant, type Result } from '@erc/domain'
import type { Payload } from 'payload'

import { mac, sameMac } from '@/content/form-guard'
import { absoluteUrl } from '@/site-config'

import { enterAsMember } from './sign-in'

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])
const HANDOFF_TTL_MS = 10 * 60_000

export const GOOGLE_HANDOFF_COOKIE = '__Host-erc_google'
export const GOOGLE_CALLBACK_PATH = '/api/v1/google/callback'

type GoogleSettings = { clientId: string; clientSecret: string }

const googleSettings = (): GoogleSettings | null => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export const googleSignInOpen = (): boolean => googleSettings() !== null

/**
 * What the browser carries to Google and back, in a signed cookie: `state` ties the callback to this browser, `nonce`
 * ties the ID token to this attempt, and `declaredAt` is when the "18 or over" box was ticked.
 */
export type GoogleHandoff = { state: string; nonce: string; declaredAt: Instant }

const random = () => randomBytes(24).toString('base64url')

export const newHandoff = (now: Date): GoogleHandoff => ({ state: random(), nonce: random(), declaredAt: now.toISOString() as Instant })

export const sealHandoff = (handoff: GoogleHandoff): string => {
  const body = Buffer.from(JSON.stringify(handoff)).toString('base64url')
  return `${body}.${mac('google-handoff', body)}`
}

export function openHandoff(sealed: string | undefined, now: Date): GoogleHandoff | null {
  const [body, signature] = (sealed ?? '').split('.')
  if (!body || !signature || !sameMac(signature, mac('google-handoff', body))) return null
  const handoff = JSON.parse(Buffer.from(body, 'base64url').toString()) as GoogleHandoff
  const age = now.getTime() - new Date(handoff.declaredAt).getTime()
  return age >= 0 && age <= HANDOFF_TTL_MS ? handoff : null
}

export const handoffCookie = () => ({ httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: HANDOFF_TTL_MS / 1000 })

export function authorizeUrl(handoff: GoogleHandoff): string | null {
  const settings = googleSettings()
  if (!settings) return null
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: absoluteUrl(GOOGLE_CALLBACK_PATH),
    response_type: 'code',
    scope: 'openid email',
    state: handoff.state,
    nonce: handoff.nonce,
    prompt: 'select_account',
  })
  return `${AUTHORIZE}?${params}`
}

type IdClaims = { iss?: unknown; aud?: unknown; exp?: unknown; nonce?: unknown; sub?: unknown; email?: unknown; email_verified?: unknown; hd?: unknown }

/**
 * Who Google says signed in. `sub` is Google's stable id for the account. `addressIsGoogles` is true when Google runs
 * the mailbox itself (Gmail, or a Workspace domain, which Google marks with `hd`); only then does a verified address
 * prove the person controls that mailbox today rather than at some point in the past.
 */
export type GoogleIdentity = { sub: string; email: Email; addressIsGoogles: boolean }

export type GoogleRefusal = 'exchange_failed' | 'unverified'

const claimsOf = (idToken: string): IdClaims | null => {
  const claims: unknown = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString())
  return typeof claims === 'object' && claims !== null ? (claims as IdClaims) : null
}

/**
 * Trades the code for an ID token. The token comes straight from Google's token endpoint over TLS, authenticated with
 * our secret, so OpenID Connect lets us skip its signature check; the issuer, audience, expiry, and nonce are still
 * checked. Anything malformed, from the network to the token, is a failed exchange rather than a thrown error.
 */
export async function googleIdentityFrom(code: string, nonce: string, now: Date): Promise<Result<GoogleIdentity, GoogleRefusal>> {
  const settings = googleSettings()
  if (!settings) return err('exchange_failed')
  let claims: IdClaims | null
  try {
    const response = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        redirect_uri: absoluteUrl(GOOGLE_CALLBACK_PATH),
        grant_type: 'authorization_code',
      }),
    })
    if (!response.ok) return err('exchange_failed')
    const { id_token: idToken } = (await response.json()) as { id_token?: unknown }
    claims = typeof idToken === 'string' ? claimsOf(idToken) : null
  } catch {
    return err('exchange_failed')
  }
  const current =
    claims !== null &&
    typeof claims.iss === 'string' &&
    ISSUERS.has(claims.iss) &&
    claims.aud === settings.clientId &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > now.getTime() &&
    typeof claims.nonce === 'string' &&
    sameMac(claims.nonce, nonce) &&
    typeof claims.sub === 'string' &&
    claims.sub !== ''
  if (!current || !claims || typeof claims.sub !== 'string') return err('exchange_failed')
  if (claims.email_verified !== true || typeof claims.email !== 'string') return err('unverified')
  const email = parseEmail(claims.email.trim().toLowerCase())
  if (!email.ok) return err('unverified')
  return ok({ sub: claims.sub, email: email.value, addressIsGoogles: email.value.endsWith('@gmail.com') || typeof claims.hd === 'string' })
}

export type GoogleEntryRefusal = 'suspended' | 'link_needs_code' | 'linked_elsewhere'

/**
 * A Google account already linked signs in to its member. An unlinked one creates a member for a new address, or links
 * to the member holding that address when Google runs the mailbox; for any other address the member must sign in with
 * an emailed code instead, because Google's verification may be stale.
 */
export async function enterWithGoogle(
  payload: Payload,
  identity: GoogleIdentity,
  declaredAt: Instant,
  label: string,
): Promise<Result<IssuedSession, GoogleEntryRefusal>> {
  return withAddressLock(payload, identity.email, async () => {
    const db = payload.db.drizzle
    const { rows: linked } = await db.execute(sql`SELECT m.email FROM google_identities g JOIN members m ON m.id = g.member_id WHERE g.sub = ${identity.sub}`)
    const linkedEmail = (linked[0] as { email: Email } | undefined)?.email
    if (linkedEmail) return enterAsMember(payload, linkedEmail, declaredAt, 'cookie', label)

    const { rows: holders } = await db.execute(sql`
      SELECT m.id, g.sub FROM members m LEFT JOIN google_identities g ON g.member_id = m.id WHERE m.email = ${identity.email}`)
    const holder = holders[0] as { id: number; sub: string | null } | undefined
    if (holder && !identity.addressIsGoogles) return err('link_needs_code')
    if (holder?.sub) return err('linked_elsewhere')

    const entered = await enterAsMember(payload, identity.email, declaredAt, 'cookie', label)
    if (!entered.ok) return entered
    await db.execute(sql`
      INSERT INTO google_identities (sub, member_id)
      SELECT ${identity.sub}, id FROM members WHERE email = ${identity.email}`)
    return entered
  })
}

/**
 * Runs `work` while holding a lock on the address, so two callbacks for it cannot both decide on a member before either
 * has linked it. `work` writes on ordinary connections, which commit before the lock's transaction ends and releases it.
 */
async function withAddressLock<T>(payload: Payload, email: Email, work: () => Promise<T>): Promise<T> {
  const transactionID = await payload.db.beginTransaction()
  const transaction = transactionID === null ? undefined : (payload.db.sessions?.[transactionID]?.db as Payload['db']['drizzle'] | undefined)
  if (transactionID === null || !transaction) throw new Error('Google sign-in needs database transactions')
  try {
    await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`)
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`google-sign-in:${email}`}))`)
    return await work()
  } finally {
    await payload.db.commitTransaction(transactionID)
  }
}
