import { randomBytes } from 'node:crypto'

import { err, ok, parseEmail, type Email, type Instant, type Result } from '@erc/domain'

import { mac, sameMac } from '@/content/form-guard'
import { absoluteUrl } from '@/site-config'

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

type IdClaims = { iss?: unknown; aud?: unknown; exp?: unknown; nonce?: unknown; email?: unknown; email_verified?: unknown }

export type GoogleRefusal = 'exchange_failed' | 'unverified'

/**
 * Trades the code for an ID token and returns its address only if Google has verified it. The token comes straight
 * from Google's token endpoint over TLS, authenticated with our secret, so OpenID Connect lets us skip its signature
 * check; the issuer, audience, expiry, and nonce are still checked.
 */
export async function verifiedEmailFrom(code: string, nonce: string, now: Date): Promise<Result<Email, GoogleRefusal>> {
  const settings = googleSettings()
  if (!settings) return err('exchange_failed')
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
  if (typeof idToken !== 'string') return err('exchange_failed')
  const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString()) as IdClaims
  const current =
    typeof claims.iss === 'string' &&
    ISSUERS.has(claims.iss) &&
    claims.aud === settings.clientId &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > now.getTime() &&
    typeof claims.nonce === 'string' &&
    sameMac(claims.nonce, nonce)
  if (!current) return err('exchange_failed')
  if (claims.email_verified !== true || typeof claims.email !== 'string') return err('unverified')
  const email = parseEmail(claims.email.trim().toLowerCase())
  return email.ok ? ok(email.value) : err('unverified')
}
