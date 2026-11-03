import { NextResponse } from 'next/server'
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { parseStravaRun, type MemberId, type StravaRunPayload } from '@erc/domain'
import { getPayload } from 'payload'

import { disconnectStravaByAthleteId, getValidStravaToken } from '@/members/strava'

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

export async function POST(request: Request): Promise<Response> {
  if (process.env.STRAVA_ENABLED !== 'true') {
    return NextResponse.json({ ok: true })
  }

  try {
    const body = (await request.json().catch(() => null)) as {
      object_type?: string
      aspect_type?: string
      object_id?: number | string
      owner_id?: number | string
      updates?: Record<string, unknown>
    } | null

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: true })
    }

    const { object_type, aspect_type, object_id, owner_id, updates } = body

    const payload = await getPayload({ config })
    const db = payload.db.drizzle

    // 1. Athlete deauthorization
    if (
      object_type === 'athlete' &&
      (updates?.authorized === 'false' || updates?.authorized === false)
    ) {
      const athleteId = Number(owner_id || object_id)
      if (athleteId > 0) {
        await disconnectStravaByAthleteId(payload, athleteId)
      }
      return NextResponse.json({ ok: true })
    }

    // 2. Activity delete
    if (object_type === 'activity' && aspect_type === 'delete') {
      const athleteId = Number(owner_id)
      const ref = `strava:${object_id}`
      if (athleteId > 0 && object_id) {
        await db.execute(sql`
          DELETE FROM activities
          WHERE source = 'strava'
            AND ref = ${ref}
            AND member_id = (SELECT member_id FROM strava_connections WHERE athlete_id = ${athleteId} LIMIT 1)
        `)
      }
      return NextResponse.json({ ok: true })
    }

    // 3. Activity create
    if (object_type === 'activity' && aspect_type === 'create') {
      const athleteId = Number(owner_id)
      if (!athleteId || !object_id) {
        return NextResponse.json({ ok: true })
      }

      const { rows } = await db.execute(sql`
        SELECT member_id, status
        FROM strava_connections
        WHERE athlete_id = ${athleteId}
      `)

      if (rows.length === 0 || !rows[0]?.member_id) {
        return NextResponse.json({ ok: true })
      }

      const memberId = rows[0].member_id as MemberId
      if (rows[0].status !== 'connected') {
        return NextResponse.json({ ok: true })
      }

      const token = await getValidStravaToken(payload, memberId)
      if (!token) {
        return NextResponse.json({ ok: true })
      }

      const res = await fetch(`https://www.strava.com/api/v3/activities/${object_id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })

      if (res.status === 401) {
        await db.execute(sql`
          UPDATE strava_connections
          SET status = 'disconnected', updated_at = now()
          WHERE member_id = ${memberId}
        `)
        return NextResponse.json({ ok: true })
      }

      if (!res.ok) {
        return NextResponse.json({ ok: true })
      }

      const data = (await res.json()) as StravaRunPayload
      const parsed = parseStravaRun(data, memberId)
      if (!parsed.ok) {
        return NextResponse.json({ ok: true })
      }

      const run = parsed.value
      await db.execute(sql`
        INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, note)
        VALUES (${run.member}, 'strava', ${run.ref}, ${run.on}, ${run.distance}, ${run.moving}, ${run.note ?? null})
        ON CONFLICT (member_id, source, ref) DO UPDATE SET
          on_date = EXCLUDED.on_date,
          metres = EXCLUDED.metres,
          moving_s = EXCLUDED.moving_s,
          note = EXCLUDED.note
      `)

      await db.execute(sql`
        UPDATE strava_connections
        SET last_synced_at = now(),
            updated_at = now()
        WHERE member_id = ${memberId}
      `)

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Strava webhook handling failed:', error)
    return NextResponse.json({ ok: true })
  }
}
