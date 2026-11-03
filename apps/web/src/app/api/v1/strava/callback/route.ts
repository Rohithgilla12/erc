import { NextResponse } from 'next/server'
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { type MemberId } from '@erc/domain'
import { getPayload } from 'payload'

import { resolveSessionFromCookie } from '@/members/session'
import { disconnectStrava, joinStravaWaitlist, syncStravaActivities } from '@/members/strava'
import { encryptToken, verifyOAuthState } from '@/members/strava-crypto'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  // Feature flag check
  if (process.env.STRAVA_ENABLED !== 'true') {
    return NextResponse.redirect(new URL('/me', request.url))
  }

  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const scope = url.searchParams.get('scope')

  // 1. Check for access_denied error from Strava
  if (error === 'access_denied') {
    return NextResponse.redirect(new URL('/me?strava=denied', request.url))
  }

  // 2. Resolve member session
  const payload = await getPayload({ config })
  const session = await resolveSessionFromCookie(payload, request.headers.get('cookie'))

  if (!session) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // 3. Validate state signature and match with logged-in member session
  const secret = process.env.PAYLOAD_SECRET
  if (!secret || !state || !verifyOAuthState(state, session.member, secret)) {
    return NextResponse.redirect(new URL('/me?strava=denied', request.url))
  }

  // Check requested scope if present (Strava sends comma-separated scopes)
  if (scope && !scope.includes('activity:read')) {
    return NextResponse.redirect(new URL('/me?strava=denied', request.url))
  }

  if (!code) {
    return NextResponse.redirect(new URL('/me?strava=denied', request.url))
  }

  // 4. Pilot Cap Check
  const db = payload.db.drizzle
  const memberConnRes = await db.execute(sql`
    SELECT status FROM strava_connections WHERE member_id = ${session.member}
  `)
  const isAlreadyConnected =
    memberConnRes.rows.length > 0 && memberConnRes.rows[0]?.status === 'connected'

  const countRes = await db.execute(sql`
    SELECT count(*)::int AS count FROM strava_connections WHERE status = 'connected'
  `)
  const connectedCount = (countRes.rows[0] as { count: number })?.count ?? 0
  const parsedCap = parseInt(process.env.STRAVA_ATHLETE_CAP || '10', 10)
  const cap = Number.isFinite(parsedCap) && parsedCap >= 0 ? parsedCap : 10

  // If at or above cap and not already connected: mark/upsert waitlisted
  if (connectedCount >= cap && !isAlreadyConnected) {
    await joinStravaWaitlist(payload, session.member)
    return NextResponse.redirect(new URL('/me?strava=waitlisted', request.url))
  }

  // 5. Under cap (or re-connecting): exchange authorization code
  const clientId = process.env.STRAVA_CLIENT_ID
  const clientSecret = process.env.STRAVA_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/me?strava=error', request.url))
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL('/me?strava=error', request.url))
    }

    const data = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_at: number
      athlete?: { id: number | string }
    }

    if (!data.access_token || !data.refresh_token || !data.expires_at || !data.athlete?.id) {
      return NextResponse.redirect(new URL('/me?strava=error', request.url))
    }

    const athleteId = Number(data.athlete.id)
    const encAccessToken = encryptToken(data.access_token)
    const encRefreshToken = encryptToken(data.refresh_token)
    const tokenExpiresAt = new Date(data.expires_at * 1000).toISOString()
    const grantedScope = scope || 'read,activity:read'

    // If this athlete was previously linked to another member, disconnect that member and purge their Strava activities
    if (athleteId > 0) {
      const { rows: conflictRows } = await db.execute(sql`
        SELECT member_id
        FROM strava_connections
        WHERE athlete_id = ${athleteId} AND member_id != ${session.member}
      `)
      for (const row of conflictRows as { member_id: number }[]) {
        await disconnectStrava(payload, row.member_id as MemberId)
      }
    }

    // Upsert into strava_connections with status = 'connected'
    await db.execute(sql`
      INSERT INTO strava_connections (
        member_id,
        athlete_id,
        access_token,
        refresh_token,
        token_expires_at,
        scope,
        status,
        created_at,
        updated_at
      )
      VALUES (
        ${session.member},
        ${athleteId},
        ${encAccessToken},
        ${encRefreshToken},
        ${tokenExpiresAt}::timestamptz,
        ${grantedScope},
        'connected',
        now(),
        now()
      )
      ON CONFLICT (member_id) DO UPDATE SET
        athlete_id = EXCLUDED.athlete_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        status = 'connected',
        updated_at = now()
    `)

    // Trigger initial 90-day sync
    try {
      await syncStravaActivities(payload, session.member, { lookbackDays: 90 })
    } catch {
      // If initial sync encounters an error, connection was still established
    }

    return NextResponse.redirect(new URL('/me?strava=connected', request.url))
  } catch {
    return NextResponse.redirect(new URL('/me?strava=error', request.url))
  }
}
