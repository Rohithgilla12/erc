/**
 * "Continue with Google" end to end against the local database, with Google's token endpoint stubbed: the start
 * redirect and handoff cookie, every callback refusal, account creation, linking by Google account and by address,
 * session replacement, simultaneous first sign-ins, and suspended members.
 *
 * Run via: pnpm --filter @erc/web payload run src/scripts/check-google.ts
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { NextRequest } from 'next/server'
import { getPayload } from 'payload'

import { GET as callbackGet } from '@/app/api/v1/google/callback/route'
import { POST as startPost } from '@/app/api/v1/google/start/route'
import { GOOGLE_HANDOFF_COOKIE } from '@/members/google'
import { resolveSession, SESSION_COOKIE } from '@/members/session'
import { enterAsMember } from '@/members/sign-in'

process.env.GOOGLE_CLIENT_ID = 'check-client.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET = 'check-secret'

const payload = await getPayload({ config })
const runId = Date.now()
const SITE = 'http://localhost:3000'
let passes = 0
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  if (JSON.stringify(actual) === JSON.stringify(wanted)) {
    passes++
    console.log(`PASS ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL ${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
  }
}

type Claims = Record<string, unknown>
let nextClaims: Claims | null = null
let tokenStatus = 200
let rawTokenResponse: string | null = null
let networkDown = false
let lastTokenBody = ''
const originalFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url !== 'https://oauth2.googleapis.com/token') return originalFetch(input, init)
  lastTokenBody = String(init?.body ?? '')
  if (networkDown) throw new TypeError('fetch failed')
  if (rawTokenResponse !== null) return new Response(rawTokenResponse, { status: 200, headers: { 'content-type': 'application/json' } })
  const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const idToken = `${segment({ alg: 'RS256' })}.${segment(nextClaims ?? {})}.signature`
  return new Response(JSON.stringify({ id_token: idToken }), { status: tokenStatus, headers: { 'content-type': 'application/json' } })
}

const cookieOf = (response: Response, name: string) => {
  const line = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`))
  return line === undefined ? undefined : line.slice(name.length + 1).split(';')[0]
}

async function start(over18: boolean, origin: string | null = SITE, body?: BodyInit) {
  const form = new FormData()
  if (over18) form.set('over18', 'on')
  const headers: Record<string, string> = origin === null ? {} : { origin }
  return startPost(new Request(`${SITE}/api/v1/google/start`, { method: 'POST', body: body ?? form, headers }))
}

/** A fresh start, then the callback with whatever the test overrides. */
async function roundTrip(claims: (nonce: string) => Claims, options: { state?: string; handoff?: string; extraCookie?: string; code?: string | null } = {}) {
  const started = await start(true)
  const location = new URL(started.headers.get('location') ?? '')
  const handoff = options.handoff ?? cookieOf(started, GOOGLE_HANDOFF_COOKIE) ?? ''
  nextClaims = claims(location.searchParams.get('nonce') ?? '')
  const params = new URLSearchParams({ state: options.state ?? location.searchParams.get('state') ?? '' })
  if (options.code !== null) params.set('code', options.code ?? 'auth-code')
  const cookie = [`${GOOGLE_HANDOFF_COOKIE}=${handoff}`, options.extraCookie].filter(Boolean).join('; ')
  return callbackGet(new NextRequest(`${SITE}/api/v1/google/callback?${params}`, { headers: { cookie } }))
}

const good = (email: string, sub = `sub-${email.toLowerCase()}`) => (nonce: string) => ({
  iss: 'https://accounts.google.com',
  sub,
  aud: process.env.GOOGLE_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 300,
  nonce,
  email,
  email_verified: true,
})

const memberByEmail = async (email: string) => {
  const { rows } = await payload.db.drizzle.execute(sql`SELECT id, age_declared_at, status FROM members WHERE email = ${email}`)
  return rows[0] as { id: number; age_declared_at: Date | null; status: string } | undefined
}

const newAddress = `google-${runId}@example.com`
const existingAddress = `google-existing-${runId}@gmail.com`
const suspendedAddress = `google-suspended-${runId}@gmail.com`
const outsideAddress = `google-outside-${runId}@example.org`
const workspaceAddress = `google-ws-${runId}@club.example`
const racedAddress = `google-race-${runId}@example.com`
const takenAddress = `google-taken-${runId}@gmail.com`
const codeRaceAddress = `code-race-${runId}@example.com`

try {
  const refused = await start(false)
  expect('start without the age box returns to sign-in', [refused.status, refused.headers.get('location')], [303, `${SITE}/sign-in?google=age`])
  expect('start without the age box sets no handoff', cookieOf(refused, GOOGLE_HANDOFF_COOKIE), undefined)

  const started = await start(true)
  const location = new URL(started.headers.get('location') ?? '')
  expect('start redirects to Google', [started.status, location.origin + location.pathname], [303, 'https://accounts.google.com/o/oauth2/v2/auth'])
  expect('start asks only for openid email', location.searchParams.get('scope'), 'openid email')
  expect('start names the public callback', location.searchParams.get('redirect_uri'), `${SITE}/api/v1/google/callback`)
  expect('start sends state and nonce', [Boolean(location.searchParams.get('state')), Boolean(location.searchParams.get('nonce'))], [true, true])
  expect('start without an Origin is refused', (await start(true, null)).status, 403)
  expect('start from another site is refused', (await start(true, 'https://evil.example')).status, 403)
  const garbled = await start(true, SITE, 'not a form')
  expect('a garbled start body asks for the age box instead of failing', [garbled.status, garbled.headers.get('location')], [303, `${SITE}/sign-in?google=age`])
  const handoffLine = started.headers.getSetCookie().find((cookie) => cookie.startsWith(`${GOOGLE_HANDOFF_COOKIE}=`)) ?? ''
  expect('handoff cookie is HttpOnly, Secure, Lax', [/HttpOnly/i.test(handoffLine), /Secure/i.test(handoffLine), /SameSite=lax/i.test(handoffLine)], [true, true, true])

  const back = (response: Response) => response.headers.get('location')
  expect('no handoff cookie is refused', back(await roundTrip(good(newAddress), { handoff: '' })), `${SITE}/sign-in?google=expired`)
  expect('a forged handoff is refused', back(await roundTrip(good(newAddress), { handoff: 'eyJ9.forged' })), `${SITE}/sign-in?google=expired`)
  expect('a state from another attempt is refused', back(await roundTrip(good(newAddress), { state: 'other' })), `${SITE}/sign-in?google=expired`)
  expect('a cancelled consent returns to sign-in', back(await roundTrip(good(newAddress), { code: null })), `${SITE}/sign-in?google=cancelled`)
  expect('a wrong nonce is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), nonce: `${nonce}x` }))), `${SITE}/sign-in?google=failed`)
  expect('another client audience is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), aud: 'someone-else' }))), `${SITE}/sign-in?google=failed`)
  expect('an expired token is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), exp: 1 }))), `${SITE}/sign-in?google=failed`)
  expect('another issuer is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), iss: 'https://evil.example' }))), `${SITE}/sign-in?google=failed`)
  expect('an unverified address is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), email_verified: false }))), `${SITE}/sign-in?google=unverified`)
  expect('a token without a subject is refused', back(await roundTrip((nonce) => ({ ...good(newAddress)(nonce), sub: undefined }))), `${SITE}/sign-in?google=failed`)
  tokenStatus = 400
  expect('a failed code exchange is refused', back(await roundTrip(good(newAddress))), `${SITE}/sign-in?google=failed`)
  tokenStatus = 200
  networkDown = true
  const offline = await roundTrip(good(newAddress))
  expect('an unreachable Google is refused, not a 500', [offline.status, back(offline)], [307, `${SITE}/sign-in?google=failed`])
  expect('a failed callback still clears the handoff', cookieOf(offline, GOOGLE_HANDOFF_COOKIE), '')
  networkDown = false
  for (const [label, raw] of [['a non-JSON token response', 'oops'], ['a JSON null response', 'null'], ['a malformed ID token', JSON.stringify({ id_token: 'a.%%%.c' })], ['an ID token of null', JSON.stringify({ id_token: `x.${Buffer.from('null').toString('base64url')}.y` })]] as const) {
    rawTokenResponse = raw
    expect(`${label} is refused, not a 500`, back(await roundTrip(good(newAddress))), `${SITE}/sign-in?google=failed`)
  }
  rawTokenResponse = null
  expect('no refusal created a member', await memberByEmail(newAddress), undefined)

  const before = Date.now()
  const created = await roundTrip(good(newAddress.toUpperCase()))
  expect('a verified address signs in and lands on /me', [created.status, back(created)], [307, `${SITE}/me`])
  expect('the exchange sent the public redirect URI', new URLSearchParams(lastTokenBody).get('redirect_uri'), `${SITE}/api/v1/google/callback`)
  expect('the handoff cookie is cleared', cookieOf(created, GOOGLE_HANDOFF_COOKIE), '')
  const member = await memberByEmail(newAddress)
  expect('the member is created under the lowercased address', Boolean(member), true)
  const declared = member?.age_declared_at ? new Date(member.age_declared_at).getTime() : 0
  expect('the age declaration is the time the box was ticked', declared >= before - 1000 && declared <= Date.now(), true)
  const token = cookieOf(created, SESSION_COOKIE) ?? ''
  const session = await resolveSession(payload, token, 'cookie')
  expect('the session cookie resolves to that member', session?.member, member?.id)

  const again = await roundTrip(good(newAddress), { extraCookie: `${SESSION_COOKIE}=${token}` })
  expect('signing in again replaces the old session', await resolveSession(payload, token, 'cookie'), null)
  const { rows: sessions } = await payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM member_sessions WHERE member_id = ${member?.id ?? 0}`)
  expect('one live session remains', (sessions[0] as { n: number }).n, 1)
  expect('the second sign-in also lands on /me', back(again), `${SITE}/me`)

  const renamed = await roundTrip(good(`renamed-${runId}@example.com`, `sub-${newAddress}`))
  expect('a linked Google account signs in to its member even after its address changes', (await resolveSession(payload, cookieOf(renamed, SESSION_COOKIE) ?? '', 'cookie'))?.member, member?.id)
  expect('no member is created for the changed address', await memberByEmail(`renamed-${runId}@example.com`), undefined)

  const createMember = (email: string, status = 'active') =>
    payload.create({ collection: 'members', data: { email, status: status as 'active', ageDeclaredAt: '2026-01-01T00:00:00.000Z' }, context: { skipRevalidation: true } })

  const existing = await createMember(existingAddress)
  const linked = await roundTrip(good(existingAddress))
  const linkedSession = await resolveSession(payload, cookieOf(linked, SESSION_COOKIE) ?? '', 'cookie')
  expect('an existing Gmail member is linked and signed in, not duplicated', linkedSession?.member, existing.id)
  expect('their original age declaration is kept', new Date((await memberByEmail(existingAddress))?.age_declared_at ?? 0).toISOString(), '2026-01-01T00:00:00.000Z')

  await createMember(outsideAddress)
  const outside = await roundTrip(good(outsideAddress))
  expect('an existing member at a non-Google address must use the emailed code', back(outside), `${SITE}/sign-in?google=link_needs_code`)
  expect('that refusal issues no session', cookieOf(outside, SESSION_COOKIE), undefined)

  const workspace = await createMember(workspaceAddress)
  const viaWorkspace = await roundTrip((nonce) => ({ ...good(workspaceAddress)(nonce), hd: 'club.example' }))
  expect('an existing member at a Workspace address is linked', (await resolveSession(payload, cookieOf(viaWorkspace, SESSION_COOKIE) ?? '', 'cookie'))?.member, workspace.id)

  await createMember(takenAddress)
  await roundTrip(good(takenAddress, 'first-google-account'))
  const second = await roundTrip(good(takenAddress, 'second-google-account'))
  expect('a member already linked refuses a second Google account', back(second), `${SITE}/sign-in?google=linked_elsewhere`)
  expect('that refusal issues no session', cookieOf(second, SESSION_COOKIE), undefined)

  const raced = await Promise.all([roundTrip(good(racedAddress)), roundTrip(good(racedAddress))])
  expect('two simultaneous first sign-ins both land on /me', raced.map(back), [`${SITE}/me`, `${SITE}/me`])
  const { rows: racedRows } = await payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM members WHERE email = ${racedAddress}`)
  expect('and create exactly one member', (racedRows[0] as { n: number }).n, 1)

  const codeRace = await Promise.all(
    [1, 2, 3].map(() => enterAsMember(payload, codeRaceAddress as never, new Date().toISOString() as never, 'cookie', 'Web browser')),
  )
  expect('simultaneous first sign-ins by any path all succeed', codeRace.map((entered) => entered.ok), [true, true, true])
  const { rows: codeRaceRows } = await payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM members WHERE email = ${codeRaceAddress}`)
  expect('and share one member', (codeRaceRows[0] as { n: number }).n, 1)

  await createMember(suspendedAddress, 'suspended')
  const suspended = await roundTrip(good(suspendedAddress))
  expect('a suspended member is refused', back(suspended), `${SITE}/sign-in?google=suspended`)
  expect('a suspended member gets no session cookie', cookieOf(suspended, SESSION_COOKIE), undefined)
} finally {
  globalThis.fetch = originalFetch
  const addresses = [newAddress, existingAddress, suspendedAddress, outsideAddress, workspaceAddress, racedAddress, takenAddress, codeRaceAddress]
  await payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE member_id IN (SELECT id FROM members WHERE email IN (${sql.join(addresses.map((a) => sql`${a}`), sql`, `)}))`)
  await payload.db.drizzle.execute(sql`DELETE FROM members WHERE email IN (${sql.join(addresses.map((a) => sql`${a}`), sql`, `)})`)
}

console.log(`\ncheck-google: ${passes} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
