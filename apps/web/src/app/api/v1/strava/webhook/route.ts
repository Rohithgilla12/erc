import { NextResponse } from 'next/server'
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { parseStravaActivityId, stravaRef, type MemberId } from '@erc/domain'
import { getPayload } from 'payload'

import { disconnectStravaByAthleteId } from '@/members/strava'
import { dropStravaJobs, queueStravaJob } from '@/members/strava-jobs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (process.env.STRAVA_ENABLED !== 'true') {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const verifyToken = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN
  if (
    mode === 'subscribe' &&
    expectedToken &&
    verifyToken === expectedToken &&
    challenge
  ) {
    return NextResponse.json({ 'hub.challenge': challenge })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

/**
 * Strava retries an event that is not answered within two seconds, so nothing here calls Strava: creates and updates
 * are queued for the drain, and every outcome answers 200 so a refused event is not redelivered.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.STRAVA_ENABLED !== 'true') {
    return NextResponse.json({ ok: true })
  }

  try {
    const body: unknown = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: true })
    }
    const { object_type, aspect_type, object_id, owner_id, updates } = body as {
      object_type?: unknown
      aspect_type?: unknown
      object_id?: unknown
      owner_id?: unknown
      updates?: Record<string, unknown>
    }

    const payload = await getPayload({ config })
    const db = payload.db.drizzle

    if (object_type === 'athlete' && (updates?.authorized === 'false' || updates?.authorized === false)) {
      const athleteId = Number(owner_id || object_id)
      if (athleteId > 0) {
        await disconnectStravaByAthleteId(payload, athleteId)
      }
      return NextResponse.json({ ok: true })
    }

    const activityId = parseStravaActivityId(object_id)
    const athleteId = Number(owner_id)
    if (object_type !== 'activity' || !activityId.ok || !Number.isSafeInteger(athleteId) || athleteId <= 0) {
      return NextResponse.json({ ok: true })
    }

    const { rows } = await db.execute(sql`SELECT member_id, status FROM strava_connections WHERE athlete_id = ${athleteId} LIMIT 1`)
    const connection = rows[0] as { member_id: MemberId; status: string } | undefined
    if (!connection) {
      return NextResponse.json({ ok: true })
    }
    const member = connection.member_id

    if (aspect_type === 'delete') {
      await db.transaction(async (tx) => {
        await dropStravaJobs(tx, member, activityId.value)
        await tx.execute(sql`DELETE FROM activities WHERE member_id = ${member} AND source = 'strava' AND ref = ${stravaRef(activityId.value)}`)
      })
      return NextResponse.json({ ok: true })
    }

    if (connection.status !== 'connected') {
      return NextResponse.json({ ok: true })
    }

    // A detail fetch rewrites the run's title, type and metrics, and queues streams for a run that has none yet.
    if (aspect_type === 'create' || aspect_type === 'update') {
      await queueStravaJob(db, member, activityId.value, 'detail')
      if (aspect_type === 'create') await queueStravaJob(db, member, activityId.value, 'streams')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Strava webhook handling failed:', error)
    return NextResponse.json({ ok: true })
  }
}
