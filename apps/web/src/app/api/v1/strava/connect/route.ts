import { NextResponse } from 'next/server'
import config from '@payload-config'
import { getPayload } from 'payload'

import { resolveSessionFromCookie } from '@/members/session'
import { signOAuthState } from '@/members/strava-crypto'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const payload = await getPayload({ config })
  const session = await resolveSessionFromCookie(payload, request.headers.get('cookie'))

  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  if (process.env.STRAVA_ENABLED !== 'true') {
    return NextResponse.redirect(new URL('/me', request.url))
  }

  const clientId = process.env.STRAVA_CLIENT_ID
  const redirectUri = process.env.STRAVA_REDIRECT_URI
  const secret = process.env.PAYLOAD_SECRET

  if (!clientId || !redirectUri || !secret) {
    return NextResponse.redirect(new URL('/me?strava=error', request.url))
  }

  const state = signOAuthState(session.member, secret)
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read,activity:read&approval_prompt=auto&state=${state}`

  return NextResponse.redirect(authUrl)
}
