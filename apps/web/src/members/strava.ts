import { sql } from '@payloadcms/db-postgres/drizzle'
import type {
  StravaConnectionState,
  StravaStatusView,
} from '@erc/contract'
import {
  err,
  ok,
  parseStravaRun,
  type MemberId,
  type Result,
  type StravaRunPayload,
} from '@erc/domain'
import type { Payload } from 'payload'

import { decryptToken, encryptToken } from './strava-crypto'

export async function getStravaStatus(
  payload: Payload,
  memberId: MemberId,
): Promise<StravaStatusView> {
  const enabled = process.env.STRAVA_ENABLED === 'true'
  const cap = Number(process.env.STRAVA_ATHLETE_CAP || 10)

  if (!enabled) {
    return {
      enabled: false,
      status: 'disconnected',
      athleteId: null,
      lastSyncedAt: null,
      connectedCount: 0,
      cap,
      isAtCap: false,
      waitlistPosition: null,
    }
  }

  const db = payload.db.drizzle

  // Count active connected athletes
  const countRes = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM strava_connections
    WHERE status = 'connected'
  `)
  const connectedCount = (countRes.rows[0] as { count: number }).count
  const isAtCap = connectedCount >= cap

  // Get member connection details
  const memberRes = await db.execute(sql`
    SELECT athlete_id, status, last_synced_at, created_at
    FROM strava_connections
    WHERE member_id = ${memberId}
  `)

  if (memberRes.rows.length === 0) {
    return {
      enabled: true,
      status: 'disconnected',
      athleteId: null,
      lastSyncedAt: null,
      connectedCount,
      cap,
      isAtCap,
      waitlistPosition: null,
    }
  }

  const row = memberRes.rows[0] as {
    athlete_id: string | number
    status: StravaConnectionState
    last_synced_at: Date | string | null
    created_at: Date | string
  }

  let waitlistPosition: number | null = null
  if (row.status === 'waitlisted') {
    const posRes = await db.execute(sql`
      SELECT count(*)::int AS pos
      FROM strava_connections
      WHERE status = 'waitlisted'
        AND (
          created_at < (SELECT created_at FROM strava_connections WHERE member_id = ${memberId})
          OR (
            created_at = (SELECT created_at FROM strava_connections WHERE member_id = ${memberId})
            AND member_id <= ${memberId}
          )
        )
    `)
    waitlistPosition = (posRes.rows[0] as { pos: number }).pos
  }

  return {
    enabled: true,
    status: row.status,
    athleteId: row.athlete_id && Number(row.athlete_id) > 0 ? Number(row.athlete_id) : null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    connectedCount,
    cap,
    isAtCap,
    waitlistPosition,
  }
}

export async function getValidStravaToken(
  payload: Payload,
  memberId: MemberId,
): Promise<string | null> {
  const db = payload.db.drizzle

  const { rows } = await db.execute(sql`
    SELECT access_token, refresh_token, token_expires_at, status
    FROM strava_connections
    WHERE member_id = ${memberId}
  `)

  if (rows.length === 0) return null
  const row = rows[0] as {
    access_token: string
    refresh_token: string
    token_expires_at: Date | string
    status: string
  }

  if (row.status !== 'connected') return null

  const expiresAtMs = new Date(row.token_expires_at).getTime()
  const nowMs = Date.now()
  const BUFFER_MS = 5 * 60 * 1000 // 5 minutes

  // If token is expiring within 5 minutes or already expired, refresh it
  if (expiresAtMs - nowMs <= BUFFER_MS) {
    let refreshToken: string
    try {
      refreshToken = decryptToken(row.refresh_token)
    } catch {
      await db.execute(sql`
        UPDATE strava_connections
        SET status = 'disconnected', updated_at = now()
        WHERE member_id = ${memberId}
      `)
      return null
    }

    const clientId = process.env.STRAVA_CLIENT_ID
    const clientSecret = process.env.STRAVA_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      return null
    }

    try {
      const res = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      })

      if (!res.ok) {
        // Only mark disconnected on explicit client/auth failure (400 invalid_grant or 401 unauthorized).
        // 429 rate limits or 5xx server errors are transient: return null without mutating status.
        if (res.status === 400 || res.status === 401) {
          await db.execute(sql`
            UPDATE strava_connections
            SET status = 'disconnected', updated_at = now()
            WHERE member_id = ${memberId}
          `)
        }
        return null
      }

      const data = (await res.json()) as {
        access_token: string
        refresh_token: string
        expires_at: number
      }

      const encAccess = encryptToken(data.access_token)
      const encRefresh = encryptToken(data.refresh_token)
      const newExpiresAt = new Date(data.expires_at * 1000).toISOString()

      await db.execute(sql`
        UPDATE strava_connections
        SET access_token = ${encAccess},
            refresh_token = ${encRefresh},
            token_expires_at = ${newExpiresAt}::timestamptz,
            updated_at = now()
        WHERE member_id = ${memberId}
      `)

      return data.access_token
    } catch {
      return null
    }
  }

  // Otherwise token is still valid for > 5 minutes: decrypt access token
  try {
    return decryptToken(row.access_token)
  } catch {
    await db.execute(sql`
      UPDATE strava_connections
      SET status = 'disconnected', updated_at = now()
      WHERE member_id = ${memberId}
    `)
    return null
  }
}

export async function syncStravaActivities(
  payload: Payload,
  memberId: MemberId,
  options?: { lookbackDays?: number },
): Promise<Result<{ synced: number; lastSyncedAt: string }, string>> {
  if (process.env.STRAVA_ENABLED !== 'true') {
    return err('Strava integration is disabled')
  }

  const token = await getValidStravaToken(payload, memberId)
  if (!token) {
    return err('Strava is not connected or authorization expired')
  }

  const db = payload.db.drizzle
  const connRes = await db.execute(sql`
    SELECT last_synced_at
    FROM strava_connections
    WHERE member_id = ${memberId}
  `)
  const lastSyncedAtRow = connRes.rows[0]?.last_synced_at

  let after: number
  if (options?.lookbackDays !== undefined) {
    after = Math.floor((Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000) / 1000)
  } else if (lastSyncedAtRow) {
    // 1-hour overlap to catch edits to recently uploaded runs
    after = Math.floor(new Date(lastSyncedAtRow as Date | string).getTime() / 1000) - 3600
  } else {
    // Default 90 days lookback for initial sync
    after = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)
  }

  const url = `https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=200`
  try {
    const res = await fetch(url, {
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
      return err('Strava authorization revoked')
    }

    if (!res.ok) {
      return err(`Strava API error: ${res.statusText || res.status}`)
    }

    const activities = (await res.json()) as StravaRunPayload[]
    if (!Array.isArray(activities)) {
      return err('Invalid activities response from Strava')
    }

    let synced = 0
    const nowIso = new Date().toISOString()

    await db.transaction(async (tx) => {
      for (const item of activities) {
        const parsed = parseStravaRun(item, memberId)
        if (!parsed.ok) continue

        const run = parsed.value
        await tx.execute(sql`
          INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, note)
          VALUES (${run.member}, 'strava', ${run.ref}, ${run.on}, ${run.distance}, ${run.moving}, ${run.note ?? null})
          ON CONFLICT (member_id, source, ref) DO UPDATE SET
            on_date = EXCLUDED.on_date,
            metres = EXCLUDED.metres,
            moving_s = EXCLUDED.moving_s,
            note = EXCLUDED.note
        `)
        synced++
      }

      await tx.execute(sql`
        UPDATE strava_connections
        SET last_synced_at = ${nowIso}::timestamptz,
            updated_at = now()
        WHERE member_id = ${memberId}
      `)
    })

    return ok({ synced, lastSyncedAt: nowIso })
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Failed to sync Strava activities')
  }
}

export async function disconnectStrava(
  payload: Payload,
  memberId: MemberId,
): Promise<void> {
  const db = payload.db.drizzle

  // Fetch access token to attempt deauthorization with Strava
  const { rows } = await db.execute(sql`
    SELECT access_token
    FROM strava_connections
    WHERE member_id = ${memberId}
  `)

  const rawEncrypted = rows[0]?.access_token
  if (typeof rawEncrypted === 'string' && rawEncrypted.includes(':')) {
    try {
      const accessToken = decryptToken(rawEncrypted)
      if (accessToken) {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ access_token: accessToken }),
        }).catch(() => {})
      }
    } catch {
      // If token decrypt or deauthorize fails, proceed with local purge
    }
  }

  // Purge all Strava activities and connection row atomically
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM activities
      WHERE member_id = ${memberId} AND source = 'strava'
    `)
    await tx.execute(sql`
      DELETE FROM strava_connections
      WHERE member_id = ${memberId}
    `)
  })
}

export async function disconnectStravaByAthleteId(
  payload: Payload,
  athleteId: number,
): Promise<void> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT member_id
    FROM strava_connections
    WHERE athlete_id = ${athleteId}
  `)
  if (rows.length > 0 && rows[0]?.member_id) {
    await disconnectStrava(payload, rows[0].member_id as MemberId)
  }
}

export async function joinStravaWaitlist(
  payload: Payload,
  memberId: MemberId,
): Promise<{ waitlisted: true; position: number }> {
  const db = payload.db.drizzle

  await db.execute(sql`
    INSERT INTO strava_connections (member_id, athlete_id, access_token, refresh_token, token_expires_at, status, created_at, updated_at)
    VALUES (${memberId}, 0, '', '', now(), 'waitlisted', now(), now())
    ON CONFLICT (member_id) DO UPDATE SET
      status = 'waitlisted',
      created_at = CASE WHEN strava_connections.status != 'waitlisted' THEN now() ELSE strava_connections.created_at END,
      updated_at = now()
  `)

  const posRes = await db.execute(sql`
    SELECT count(*)::int AS pos
    FROM strava_connections
    WHERE status = 'waitlisted'
      AND (
        created_at < (SELECT created_at FROM strava_connections WHERE member_id = ${memberId})
        OR (
          created_at = (SELECT created_at FROM strava_connections WHERE member_id = ${memberId})
          AND member_id <= ${memberId}
        )
      )
  `)
  const position = (posRes.rows[0] as { pos: number }).pos

  return { waitlisted: true, position }
}
