import { createHash, timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'
import config from '@payload-config'
import { getPayload } from 'payload'

import { drainStravaJobs } from '@/members/strava-drain'

export const dynamic = 'force-dynamic'

// Hashing first gives equal-length buffers, so the comparison takes the same time whatever was sent.
const digest = (value: string) => createHash('sha256').update(value).digest()

const authorised = (header: string | null, secret: string) => {
  const given = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1]
  return given !== undefined && timingSafeEqual(digest(given), digest(secret))
}

/** Called by host cron every 15 minutes. With no secret configured nobody is authorised. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRAVA_DRAIN_SECRET
  if (!secret || !authorised(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }
  if (process.env.STRAVA_ENABLED !== 'true') {
    return NextResponse.json({ stopped: 'disabled' })
  }
  return NextResponse.json(await drainStravaJobs(await getPayload({ config })))
}
