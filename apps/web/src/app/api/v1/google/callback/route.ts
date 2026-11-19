import { deviceLabelOf } from '@erc/domain'
import config from '@payload-config'
import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'

import { enterWithGoogle, GOOGLE_HANDOFF_COOKIE, googleIdentityFrom, openHandoff } from '@/members/google'
import { resolveSessionFromCookie, revokeSession, SESSION_COOKIE, sessionCookie } from '@/members/session'
import { absoluteUrl } from '@/site-config'

export const dynamic = 'force-dynamic'

const redirectTo = (path: string) => {
  const response = NextResponse.redirect(absoluteUrl(path))
  response.cookies.delete(GOOGLE_HANDOFF_COOKIE)
  return response
}

export async function GET(request: NextRequest): Promise<Response> {
  const now = new Date()
  const params = request.nextUrl.searchParams
  const handoff = openHandoff(request.cookies.get(GOOGLE_HANDOFF_COOKIE)?.value, now)
  if (!handoff || params.get('state') !== handoff.state) return redirectTo('/sign-in?google=expired')
  const code = params.get('code')
  if (!code) return redirectTo('/sign-in?google=cancelled')

  const identity = await googleIdentityFrom(code, handoff.nonce, now)
  if (!identity.ok) return redirectTo(`/sign-in?google=${identity.error === 'unverified' ? 'unverified' : 'failed'}`)

  const payload = await getPayload({ config })
  const entered = await enterWithGoogle(payload, identity.value, handoff.declaredAt, deviceLabelOf(null, 'cookie'))
  if (!entered.ok) return redirectTo(`/sign-in?google=${entered.error}`)

  // Signing in again from a browser that still holds a session replaces it, so the old row does not live on unseen.
  const previous = await resolveSessionFromCookie(payload, request.headers.get('cookie'))
  if (previous) await revokeSession(payload, previous)
  const response = redirectTo('/me')
  response.cookies.set(SESSION_COOKIE, entered.value.token, sessionCookie())
  return response
}
