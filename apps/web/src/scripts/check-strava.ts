/**
 * Automated end-to-end verification script for Strava Sync integration (Slice 6).
 * Proves:
 * 1. OAuth state token signing & verification (signOAuthState, verifyOAuthState).
 * 2. Token encryption at rest: raw SQL SELECT access_token, refresh_token contains iv:tag:ciphertext.
 * 3. 10-athlete cap enforcement & waitlist position.
 * 4. Initial 90-day sync: imports runs into activities with source = 'strava' and ref = 'strava:<id>'.
 * 5. On-demand sync via syncStrava: updates runs and last_synced_at.
 * 6. Webhook events: activity.create adds a run, activity.delete removes it, and athlete deauthorization purges all tokens and activities.
 * 7. Disconnect: calls disconnectStrava, proving all Strava activities and connection rows are deleted.
 * 8. Privacy isolation: verifies PUBLIC_SOURCES query and athleteWeek exclude Strava activities.
 * 9. Run metrics: list sync stores summary metrics (cadence doubled, missing heart rate) and queues detail and streams
 *    jobs; webhooks queue instead of fetching; the drain refuses a missing or wrong secret, fetches details before
 *    streams, stops at 80% of a rate-limit window and on a 429, backs off and gives up; run detail renders; coaches
 *    see Strava runs only with STRAVA_COACH_VIEW; disconnect and deauthorisation leave no metric or job rows.
 *
 * Run via: pnpm --filter @erc/web payload run src/scripts/check-strava.ts
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  CLUB_TIME_ZONE,
  PUBLIC_SOURCES,
  type StravaActivityId,
  todayIn,
  weekOf,
  type CoachId,
  type MemberId,
  type Slug,
} from '@erc/domain'
import { getPayload } from 'payload'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { RunDetailBody } from '@/app/(frontend)/me/run-detail'

import { GET as connectGet } from '@/app/api/v1/strava/connect/route'
import { GET as callbackGet } from '@/app/api/v1/strava/callback/route'
import { GET as webhookGet, POST as webhookPost } from '@/app/api/v1/strava/webhook/route'
import { POST as drainPost } from '@/app/api/v1/strava/drain/route'
import { run, type Caller } from '@/members/run'
import { issueSession, resolveSession, SESSION_COOKIE } from '@/members/session'
import {
  getStravaStatus,
  getValidStravaToken,
  joinStravaWaitlist,
} from '@/members/strava'
import { drainStravaJobs, MAX_JOB_ATTEMPTS } from '@/members/strava-drain'
import { queueStravaJob } from '@/members/strava-jobs'
import {
  decryptToken,
  encryptToken,
  signOAuthState,
  verifyOAuthState,
} from '@/members/strava-crypto'

// Ensure Strava env variables are configured for test environment
process.env.STRAVA_ENABLED = 'true'
process.env.STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID || 'mock_strava_client_id'
process.env.STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || 'mock_strava_client_secret'
process.env.STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI || 'http://localhost:3000/api/v1/strava/callback'
process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'erc_strava_webhook_secret'
process.env.STRAVA_ATHLETE_CAP = '10'
delete process.env.STRAVA_COACH_VIEW

const payload = await getPayload({ config })
const runId = Date.now()
let passes = 0
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  if (ok) {
    passes++
    console.log(`PASS ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL ${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
  }
}

// Track created entities for robust cleanup
const createdMemberIds: number[] = []
let testCoachId: CoachId | null = null
let otherCoachId: CoachId | null = null
let testAthleteId: number | null = null
let testLinkId: string | null = null

type ActivityDbRow = {
  source: string
  ref: string
  metres: number
  moving_s: number
  note: string | null
}

// Setup mock fetch for Strava API endpoints
const originalFetch = globalThis.fetch
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response | null>
const customHandlers: FetchHandler[] = []

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

  for (const handler of customHandlers) {
    const custom = await handler(url, init)
    if (custom) return custom
  }

  // Default Strava OAuth token exchange
  if (url.startsWith('https://www.strava.com/oauth/token')) {
    const bodyStr = typeof init?.body === 'string' ? init.body : ''
    if (bodyStr.includes('refresh_token')) {
      return new Response(
        JSON.stringify({
          access_token: 'refreshed_access_token_123',
          refresh_token: 'refreshed_refresh_token_456',
          expires_at: Math.floor(Date.now() / 1000) + 21600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        access_token: 'mock_access_token_abc',
        refresh_token: 'mock_refresh_token_xyz',
        expires_at: Math.floor(Date.now() / 1000) + 21600,
        athlete: { id: 987654 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Default Strava deauthorize endpoint
  if (url.startsWith('https://www.strava.com/oauth/deauthorize')) {
    return new Response(
      JSON.stringify({ access_token: 'deauthorized' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return originalFetch(input, init)
}

try {
  // Helper to create test member
  const createTestMember = async (label: string): Promise<MemberId> => {
    const email = `check-strava-${label}-${runId}-${Math.random().toString(36).slice(2, 7)}@example.com`
    const { rows } = await payload.db.drizzle.execute(sql`
      INSERT INTO members (email, age_declared_at) VALUES (${email}, now()) RETURNING id
    `)
    const id = (rows[0] as { id: number }).id as MemberId
    createdMemberIds.push(id)
    return id
  }

  // ============================================================================
  // 1. OAuth state token signing & verification
  // ============================================================================
  console.log('\n--- 1. OAuth state token signing & verification ---')
  const memberA = await createTestMember('a')
  const secret = process.env.PAYLOAD_SECRET!

  const validState = signOAuthState(memberA, secret)
  expect('signOAuthState produces non-empty string', typeof validState === 'string' && validState.length > 0, true)
  expect('signOAuthState format is memberId.signature', validState.startsWith(`${memberA}.`), true)

  const verifyValid = verifyOAuthState(validState, memberA, secret)
  expect('verifyOAuthState approves valid state', verifyValid, true)

  const verifyWrongMember = verifyOAuthState(validState, (memberA + 999) as MemberId, secret)
  expect('verifyOAuthState rejects mismatching memberId', verifyWrongMember, false)

  const verifyTamperedSig = verifyOAuthState(`${validState}tampered`, memberA, secret)
  expect('verifyOAuthState rejects tampered signature', verifyTamperedSig, false)

  const verifyTamperedMember = verifyOAuthState(`9999.${validState.split('.')[1]}`, 9999, secret)
  expect('verifyOAuthState rejects tampered memberId prefix', verifyTamperedMember, false)

  const verifyWrongSecret = verifyOAuthState(validState, memberA, 'wrong-secret-key-123')
  expect('verifyOAuthState rejects wrong secret', verifyWrongSecret, false)

  const verifyMalformed = verifyOAuthState('notastate', memberA, secret)
  expect('verifyOAuthState rejects malformed state', verifyMalformed, false)

  // Verify /api/v1/strava/connect generates valid redirect URL with signed state
  const sessionTokenA = (await issueSession(payload, memberA, 'cookie', 'Agent Browser')).token
  const connectReq = new Request('http://localhost:3000/api/v1/strava/connect', {
    headers: { cookie: `${SESSION_COOKIE}=${sessionTokenA}` },
  })
  const connectRes = await connectGet(connectReq)
  expect('connect route responds with redirect', connectRes.status, 307)
  const location = connectRes.headers.get('location') || ''
  expect('connect redirect points to strava.com/oauth/authorize', location.startsWith('https://www.strava.com/oauth/authorize'), true)
  const locUrl = new URL(location)
  expect('connect redirect includes client_id', locUrl.searchParams.get('client_id'), process.env.STRAVA_CLIENT_ID)
  expect('connect redirect includes activity:read scope', locUrl.searchParams.get('scope')?.includes('activity:read'), true)
  const extractedState = locUrl.searchParams.get('state') || ''
  expect('connect redirect includes verified state', verifyOAuthState(extractedState, memberA, secret), true)

  // ============================================================================
  // 2. Token encryption at rest
  // ============================================================================
  console.log('\n--- 2. Token encryption at rest ---')
  const plaintextAccess = 'raw_access_secret_token_12345'
  const plaintextRefresh = 'raw_refresh_secret_token_67890'

  const encAccess = encryptToken(plaintextAccess)
  const encRefresh = encryptToken(plaintextRefresh)
  expect('encrypted token has 3 colon-separated parts', encAccess.split(':').length, 3)
  expect('encrypted token decrypts to original plaintext', decryptToken(encAccess), plaintextAccess)
  expect('encrypted refresh token decrypts to original plaintext', decryptToken(encRefresh), plaintextRefresh)

  // Insert connection row directly with encrypted values to inspect Postgres storage
  const athleteIdA = 987654
  const expiresFuture = new Date(Date.now() + 6 * 3600 * 1000).toISOString()
  await payload.db.drizzle.execute(sql`
    INSERT INTO strava_connections (
      member_id, athlete_id, access_token, refresh_token, token_expires_at, scope, status, created_at, updated_at
    ) VALUES (
      ${memberA}, ${athleteIdA}, ${encAccess}, ${encRefresh}, ${expiresFuture}::timestamptz, 'read,activity:read', 'connected', now(), now()
    )
    ON CONFLICT (member_id) DO UPDATE SET
      athlete_id = EXCLUDED.athlete_id,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      status = 'connected',
      updated_at = now()
  `)

  // Query raw SQL from Postgres to prove tokens are encrypted at rest
  const { rows: rawConnRows } = await payload.db.drizzle.execute(sql`
    SELECT access_token, refresh_token FROM strava_connections WHERE member_id = ${memberA}
  `)
  const storedConn = rawConnRows[0] as { access_token: string; refresh_token: string }
  expect('Postgres access_token is NOT stored in plaintext', storedConn.access_token !== plaintextAccess, true)
  expect('Postgres refresh_token is NOT stored in plaintext', storedConn.refresh_token !== plaintextRefresh, true)
  expect('Postgres access_token has iv:tag:ciphertext format', storedConn.access_token.includes(':'), true)
  expect('Postgres refresh_token has iv:tag:ciphertext format', storedConn.refresh_token.includes(':'), true)
  expect('Postgres access_token decrypts cleanly', decryptToken(storedConn.access_token), plaintextAccess)
  expect('Postgres refresh_token decrypts cleanly', decryptToken(storedConn.refresh_token), plaintextRefresh)

  // Test getValidStravaToken with valid token
  const validToken = await getValidStravaToken(payload, memberA)
  expect('getValidStravaToken retrieves plaintext token', validToken, plaintextAccess)

  // Test getValidStravaToken token refresh when expiring within 5 minutes
  const expiresSoon = new Date(Date.now() + 60 * 1000).toISOString()
  await payload.db.drizzle.execute(sql`
    UPDATE strava_connections
    SET token_expires_at = ${expiresSoon}::timestamptz
    WHERE member_id = ${memberA}
  `)
  const refreshedToken = await getValidStravaToken(payload, memberA)
  expect('getValidStravaToken refreshes expiring token', refreshedToken, 'refreshed_access_token_123')
  const { rows: refreshedRows } = await payload.db.drizzle.execute(sql`
    SELECT access_token FROM strava_connections WHERE member_id = ${memberA}
  `)
  const decryptedRefreshed = decryptToken((refreshedRows[0] as { access_token: string }).access_token)
  expect('Postgres stores newly encrypted refreshed token', decryptedRefreshed, 'refreshed_access_token_123')

  // Clean memberA connection row for subsequent clean flow
  await payload.db.drizzle.execute(sql`DELETE FROM strava_connections WHERE member_id = ${memberA}`)

  // ============================================================================
  // 3. 10-athlete cap enforcement & waitlist position
  // ============================================================================
  console.log('\n--- 3. 10-athlete cap enforcement & waitlist position ---')
  // Create 10 dummy connected athletes to fill the cap
  const capFillerMemberIds: MemberId[] = []
  for (let i = 1; i <= 10; i++) {
    const fillerMemberId = await createTestMember(`filler-${i}`)
    capFillerMemberIds.push(fillerMemberId)
    const dummyEnc = encryptToken(`filler-tok-${i}`)
    await payload.db.drizzle.execute(sql`
      INSERT INTO strava_connections (
        member_id, athlete_id, access_token, refresh_token, token_expires_at, status, created_at, updated_at
      ) VALUES (
        ${fillerMemberId}, ${700000 + i}, ${dummyEnc}, ${dummyEnc}, now() + interval '1 day', 'connected', now(), now()
      )
    `)
  }

  // Create 11th member attempting to connect
  const member11 = await createTestMember('eleventh')
  const sessionToken11 = (await issueSession(payload, member11, 'cookie', 'Browser 11')).token
  const state11 = signOAuthState(member11, secret)

  // 11th member hits callback route while cap is reached
  const callbackReq11 = new Request(
    `http://localhost:3000/api/v1/strava/callback?code=mock_code_11&state=${state11}&scope=read,activity:read`,
    { headers: { cookie: `${SESSION_COOKIE}=${sessionToken11}` } },
  )
  const callbackRes11 = await callbackGet(callbackReq11)
  expect('callback redirects at cap', callbackRes11.status, 307)
  const loc11 = callbackRes11.headers.get('location') || ''
  expect('callback redirect targets waitlisted page', loc11.includes('strava=waitlisted'), true)

  // Verify status for 11th member
  const status11 = await getStravaStatus(payload, member11)
  expect('11th member status is waitlisted', status11.status, 'waitlisted')
  expect('11th member isAtCap is true', status11.isAtCap, true)
  expect('11th member connectedCount is 10', status11.connectedCount, 10)
  expect('11th member cap is 10', status11.cap, 10)
  expect('11th member waitlistPosition is 1', status11.waitlistPosition, 1)

  // Create 12th member joining waitlist
  const member12 = await createTestMember('twelfth')
  const waitlist12Res = await joinStravaWaitlist(payload, member12)
  expect('12th member joinStravaWaitlist returns waitlisted: true', waitlist12Res.waitlisted, true)
  expect('12th member waitlist position is 2', waitlist12Res.position, 2)

  const status12 = await getStravaStatus(payload, member12)
  expect('12th member getStravaStatus position is 2', status12.waitlistPosition, 2)

  // Remove cap fillers and waitlisted members to release cap for Member A tests
  await payload.db.drizzle.execute(sql`
    DELETE FROM strava_connections WHERE member_id IN ${sql`(${sql.join([...capFillerMemberIds, member11, member12].map((id) => sql`${id}`), sql`, `)})`}
  `)

  // ============================================================================
  // 4. Initial 90-day sync
  // ============================================================================
  console.log('\n--- 4. Initial 90-day sync ---')
  const athleteIdMain = 556677
  const initialRunsPayload = [
    {
      id: 3001,
      name: 'Easy Morning Recovery',
      type: 'Run',
      sport_type: 'Run',
      start_date: '2026-11-01T06:30:00Z',
      start_date_local: '2026-11-01T06:30:00Z',
      distance: 6000,
      moving_time: 1800,
      elapsed_time: 1850,
      has_heartrate: true,
      average_heartrate: 144.6,
      max_heartrate: 171,
      average_cadence: 85,
      total_elevation_gain: 12.5,
      workout_type: 0,
    },
    {
      id: 3002,
      name: 'Trail Endurance Run',
      type: 'Run',
      sport_type: 'TrailRun',
      start_date: '2026-11-02T07:15:00Z',
      start_date_local: '2026-11-02T07:15:00Z',
      distance: 14000,
      moving_time: 4500,
      elapsed_time: 4600,
      has_heartrate: false,
    },
    {
      id: 3003,
      name: 'Rest Day Coffee Ride',
      type: 'Ride',
      sport_type: 'Ride',
      start_date: '2026-11-02T16:00:00Z',
      start_date_local: '2026-11-02T16:00:00Z',
      distance: 25000,
      moving_time: 3600,
      elapsed_time: 3800,
    },
  ]

  // Setup mock for athlete activities endpoint
  customHandlers.push(async (url) => {
    if (url.includes('https://www.strava.com/api/v3/athlete/activities')) {
      return new Response(JSON.stringify(initialRunsPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.startsWith('https://www.strava.com/oauth/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'valid_main_access_tok',
          refresh_token: 'valid_main_refresh_tok',
          expires_at: Math.floor(Date.now() / 1000) + 21600,
          athlete: { id: athleteIdMain },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return null
  })

  // Execute callback for memberA (now capacity is available)
  const stateA = signOAuthState(memberA, secret)
  const callbackReqA = new Request(
    `http://localhost:3000/api/v1/strava/callback?code=valid_code_a&state=${stateA}&scope=read,activity:read`,
    { headers: { cookie: `${SESSION_COOKIE}=${sessionTokenA}` } },
  )
  const callbackResA = await callbackGet(callbackReqA)
  expect('callback redirects on successful connection', callbackResA.status, 307)
  const locA = callbackResA.headers.get('location') || ''
  expect('callback redirect targets connected', locA.includes('strava=connected'), true)

  // Verify connection row
  const statusA = await getStravaStatus(payload, memberA)
  expect('memberA status is connected', statusA.status, 'connected')
  expect('memberA athleteId matches', statusA.athleteId, athleteIdMain)
  expect('memberA has lastSyncedAt timestamp', Boolean(statusA.lastSyncedAt), true)

  // Verify activities inserted with source = 'strava' and ref = 'strava:<id>'
  const { rows: memberAActivitiesRaw } = await payload.db.drizzle.execute(sql`
    SELECT source, ref, metres, moving_s, note FROM activities WHERE member_id = ${memberA} ORDER BY ref ASC
  `)
  expect('only the 2 run activities were inserted (ride ignored)', memberAActivitiesRaw.length, 2)
  const memberAActivities = memberAActivitiesRaw as unknown as ActivityDbRow[]
  const run1 = memberAActivities.find((r) => r.ref === 'strava:3001')
  const run2 = memberAActivities.find((r) => r.ref === 'strava:3002')
  expect('run1 has source = strava', run1?.source, 'strava')
  expect('run1 metres is 6000', run1?.metres, 6000)
  expect('run1 moving_s is 1800', run1?.moving_s, 1800)
  expect('run1 note is Easy Morning Recovery', run1?.note, 'Easy Morning Recovery')
  expect('run2 has source = strava', run2?.source, 'strava')
  expect('run2 metres is 14000', run2?.metres, 14000)
  expect('run2 moving_s is 4500', run2?.moving_s, 4500)

  const { rows: metricRows } = await payload.db.drizzle.execute(sql`
    SELECT ref, has_heartrate, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m, elapsed_s, workout_type, detailed_at
    FROM activity_metrics WHERE member_id = ${memberA} ORDER BY ref
  `)
  const metricsFor = (ref: string) => (metricRows as Record<string, unknown>[]).find((r) => r.ref === ref)
  expect('list sync stored metrics for both runs and not the ride', metricRows.map((r) => r.ref), ['strava:3001', 'strava:3002'])
  expect('run1 metrics carry heart rate, rounded', [metricsFor('strava:3001')?.has_heartrate, metricsFor('strava:3001')?.avg_hr, metricsFor('strava:3001')?.max_hr], [true, 145, 171])
  expect('run1 cadence is doubled from per-leg 85 to 170 spm', metricsFor('strava:3001')?.avg_cadence_spm, 170)
  expect('run1 elevation, elapsed and workout type stored', [metricsFor('strava:3001')?.elevation_gain_m, metricsFor('strava:3001')?.elapsed_s, metricsFor('strava:3001')?.workout_type], [12.5, 1850, 'default'])
  expect('run2 without a heart-rate strap stores no heart rate', [metricsFor('strava:3002')?.has_heartrate, metricsFor('strava:3002')?.avg_hr, metricsFor('strava:3002')?.avg_cadence_spm], [false, null, null])
  expect('list sync leaves detail columns for the detail job', metricsFor('strava:3001')?.detailed_at, null)

  const jobsOf = async (member: MemberId) =>
    (await payload.db.drizzle.execute(sql`SELECT strava_activity_id::text AS id, kind, attempts FROM strava_jobs WHERE member_id = ${member} ORDER BY strava_activity_id, kind`)).rows as {
      id: string
      kind: string
      attempts: number
    }[]
  expect(
    'list sync queued a detail and a streams job per run, none for the ride',
    (await jobsOf(memberA)).map((j) => `${j.id}:${j.kind}`),
    ['3001:detail', '3001:streams', '3002:detail', '3002:streams'],
  )

  // ============================================================================
  // 5. On-demand sync via syncStrava
  // ============================================================================
  console.log('\n--- 5. On-demand sync via syncStrava ---')
  const updatedRunsPayload = [
    {
      id: 3001,
      name: 'Easy Morning Recovery (Paced)',
      type: 'Run',
      sport_type: 'Run',
      start_date: '2026-11-01T06:30:00Z',
      start_date_local: '2026-11-01T06:30:00Z',
      distance: 6200,
      moving_time: 1820,
      elapsed_time: 1870,
    },
    {
      id: 3004,
      name: 'Track Intervals 8x400m',
      type: 'Run',
      sport_type: 'Run',
      start_date: '2026-11-03T06:00:00Z',
      start_date_local: '2026-11-03T06:00:00Z',
      distance: 8000,
      moving_time: 2400,
      elapsed_time: 2500,
    },
  ]

  // Override activities endpoint response
  customHandlers.unshift(async (url) => {
    if (url.includes('https://www.strava.com/api/v3/athlete/activities')) {
      return new Response(JSON.stringify(updatedRunsPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return null
  })

  const callerA: Caller = {
    kind: 'member',
    session: (await resolveSession(payload, sessionTokenA, 'cookie'))!,
    sender: '127.0.0.1',
  }

  const syncRes = await run('syncStrava', callerA, {})
  expect('syncStrava action succeeds', syncRes.ok, true)
  if (syncRes.ok) {
    expect('syncStrava returns synced count = 2', syncRes.data.synced, 2)
  }

  const { rows: postSyncActivitiesRaw } = await payload.db.drizzle.execute(sql`
    SELECT source, ref, metres, moving_s, note FROM activities WHERE member_id = ${memberA} ORDER BY ref ASC
  `)
  expect('activities count is now 3', postSyncActivitiesRaw.length, 3)
  const postSyncActivities = postSyncActivitiesRaw as unknown as ActivityDbRow[]
  const updatedRun1 = postSyncActivities.find((r) => r.ref === 'strava:3001')
  const newRun4 = postSyncActivities.find((r) => r.ref === 'strava:3004')
  expect('strava:3001 was updated with new metres', updatedRun1?.metres, 6200)
  expect('strava:3001 note was updated', updatedRun1?.note, 'Easy Morning Recovery (Paced)')
  expect('strava:3004 was added with 8000m', newRun4?.metres, 8000)

  // ============================================================================
  // 6. Webhook events (create, delete, deauthorize)
  // ============================================================================
  console.log('\n--- 6. Webhook events (create, delete, deauthorize) ---')
  // 6a. Webhook handshake
  const handshakeReq = new Request(
    `http://localhost:3000/api/v1/strava/webhook?hub.mode=subscribe&hub.verify_token=erc_strava_webhook_secret&hub.challenge=test_challenge_xyz`,
  )
  const handshakeRes = await webhookGet(handshakeReq)
  expect('webhook subscription handshake status 200', handshakeRes.status, 200)
  const handshakeJson = (await handshakeRes.json()) as { 'hub.challenge': string }
  expect('webhook subscription echoes challenge', handshakeJson['hub.challenge'], 'test_challenge_xyz')

  const invalidHandshakeReq = new Request(
    `http://localhost:3000/api/v1/strava/webhook?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge_xyz`,
  )
  const invalidHandshakeRes = await webhookGet(invalidHandshakeReq)
  expect('webhook handshake with wrong token rejected with 403', invalidHandshakeRes.status, 403)

  // 6b. Webhook activity.create
  customHandlers.unshift(async (url) => {
    if (url === 'https://www.strava.com/api/v3/activities/3005') {
      return new Response(
        JSON.stringify({
          id: 3005,
          name: 'Webhook 5K Fast',
          type: 'Run',
          sport_type: 'Run',
          start_date: '2026-11-03T18:00:00Z',
          start_date_local: '2026-11-03T18:00:00Z',
          distance: 5000,
          moving_time: 1500,
          elapsed_time: 1520,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return null
  })

  const createWebhookReq = new Request('http://localhost:3000/api/v1/strava/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object_type: 'activity',
      aspect_type: 'create',
      object_id: 3005,
      owner_id: athleteIdMain,
    }),
  })
  const createWebhookRes = await webhookPost(createWebhookReq)
  expect('webhook activity.create returns 200', createWebhookRes.status, 200)

  expect(
    'webhook activity.create queues detail and streams without calling Strava',
    (await jobsOf(memberA)).filter((j) => j.id === '3005').map((j) => j.kind),
    ['detail', 'streams'],
  )
  await payload.db.drizzle.execute(sql`UPDATE strava_jobs SET attempts = 3, not_before = now() + interval '1 hour', last_error = 'HTTP 500' WHERE strava_activity_id = 3005 AND kind = 'detail'`)
  const updateWebhookRes = await webhookPost(
    new Request('http://localhost:3000/api/v1/strava/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_type: 'activity', aspect_type: 'update', object_id: 3005, owner_id: athleteIdMain, updates: { title: 'Renamed' } }),
    }),
  )
  expect('webhook activity.update returns 200', updateWebhookRes.status, 200)
  const { rows: updatedJob } = await payload.db.drizzle.execute(sql`
    SELECT attempts, last_error, not_before <= now() AS due FROM strava_jobs WHERE strava_activity_id = 3005 AND kind = 'detail'
  `)
  expect('webhook activity.update requeues the detail job fresh and due now', updatedJob[0], { attempts: 0, last_error: null, due: true })

  const strangerWebhookRes = await webhookPost(
    new Request('http://localhost:3000/api/v1/strava/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_type: 'activity', aspect_type: 'create', object_id: 3999, owner_id: 123123123 }),
    }),
  )
  const { rows: strangerJobs } = await payload.db.drizzle.execute(sql`SELECT 1 FROM strava_jobs WHERE strava_activity_id = 3999`)
  expect('webhook for an athlete nobody connected answers 200 and queues nothing', [strangerWebhookRes.status, strangerJobs.length], [200, 0])

  await payload.db.drizzle.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, note)
    VALUES (${memberA}, 'strava', 'strava:3005', '2026-11-03', 5000, 1500, 'Webhook 5K Fast')
  `)

  // 6c. Webhook activity.delete
  const deleteWebhookReq = new Request('http://localhost:3000/api/v1/strava/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object_type: 'activity',
      aspect_type: 'delete',
      object_id: 3005,
      owner_id: athleteIdMain,
    }),
  })
  const deleteWebhookRes = await webhookPost(deleteWebhookReq)
  expect('webhook activity.delete returns 200', deleteWebhookRes.status, 200)

  const { rows: postDeleteActRows } = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM activities WHERE member_id = ${memberA} AND ref = 'strava:3005'
  `)
  expect('webhook deleted activity strava:3005 from Postgres', postDeleteActRows.length, 0)
  expect('webhook activity.delete dropped its queued jobs', (await jobsOf(memberA)).filter((j) => j.id === '3005').length, 0)

  // 6d. Athlete deauthorization webhook
  const memberB = await createTestMember('b')
  const athleteIdB = 889900
  const encB = encryptToken('token_b')
  await payload.db.drizzle.execute(sql`
    INSERT INTO strava_connections (
      member_id, athlete_id, access_token, refresh_token, token_expires_at, status, created_at, updated_at
    ) VALUES (
      ${memberB}, ${athleteIdB}, ${encB}, ${encB}, now() + interval '1 day', 'connected', now(), now()
    )
  `)
  await payload.db.drizzle.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, note)
    VALUES (${memberB}, 'strava', 'strava:9901', '2026-11-01', 7500, 2250, 'Member B Run')
  `)
  await payload.db.drizzle.execute(sql`
    INSERT INTO activity_metrics (member_id, source, ref, start_at, elapsed_s, has_heartrate) VALUES (${memberB}, 'strava', 'strava:9901', now(), 2300, false)
  `)
  await payload.db.drizzle.execute(sql`
    INSERT INTO activity_streams (member_id, source, ref, time_s, distance_m) VALUES (${memberB}, 'strava', 'strava:9901', '{0,1}', '{0,3}')
  `)
  await queueStravaJob(payload.db.drizzle, memberB, 9902 as StravaActivityId, 'detail')

  const deauthWebhookReq = new Request('http://localhost:3000/api/v1/strava/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object_type: 'athlete',
      object_id: athleteIdB,
      owner_id: athleteIdB,
      updates: { authorized: false },
    }),
  })
  const deauthWebhookRes = await webhookPost(deauthWebhookReq)
  expect('webhook deauthorize returns 200', deauthWebhookRes.status, 200)

  const { rows: bConnRows } = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM strava_connections WHERE member_id = ${memberB}
  `)
  expect('athlete deauth webhook purged strava_connections row', bConnRows.length, 0)

  const { rows: bActRows } = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM activities WHERE member_id = ${memberB} AND source = 'strava'
  `)
  expect('athlete deauth webhook purged member Strava activities', bActRows.length, 0)
  const { rows: bLeftovers } = await payload.db.drizzle.execute(sql`
    SELECT
      (SELECT count(*)::int FROM activity_metrics WHERE member_id = ${memberB}) AS metrics,
      (SELECT count(*)::int FROM activity_streams WHERE member_id = ${memberB}) AS streams,
      (SELECT count(*)::int FROM strava_jobs WHERE member_id = ${memberB}) AS jobs
  `)
  expect('athlete deauth leaves no metric, stream or job rows', bLeftovers[0], { metrics: 0, streams: 0, jobs: 0 })

  console.log('\n--- 6e. Queue drain ---')
  const memberC0 = await createTestMember('stranger')
  process.env.STRAVA_DRAIN_SECRET = 'drain-secret-for-checks'
  const drain = (authorization?: string) =>
    drainPost(new Request('http://localhost:3000/api/v1/strava/drain', { method: 'POST', headers: authorization ? { authorization } : {} }))

  expect('drain without a bearer is refused with 401', (await drain()).status, 401)
  expect('drain with the wrong secret is refused with 401', (await drain('Bearer not-the-secret')).status, 401)
  delete process.env.STRAVA_DRAIN_SECRET
  expect('drain with no secret configured refuses even an empty bearer guess', (await drain('Bearer undefined')).status, 401)
  process.env.STRAVA_DRAIN_SECRET = 'drain-secret-for-checks'
  const drainAuthorised = async () => (await (await drain('Bearer drain-secret-for-checks')).json()) as Record<string, unknown>

  const stravaCalls: string[] = []
  let readUsage = 0
  const detailStatus = new Map<number, number>()
  const detailName = new Map<number, string>([[3001, 'Easy Morning Recovery (Paced)']])
  const limited = (body: unknown, status = 200) => {
    readUsage++
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': `${readUsage},${readUsage}` },
    })
  }
  customHandlers.unshift(async (url) => {
    const match = /^https:\/\/www\.strava\.com\/api\/v3\/activities\/(\d+)(\/streams)?/.exec(url)
    if (!match) return null
    const id = Number(match[1])
    const kind = match[2] ? 'streams' : 'detail'
    stravaCalls.push(`${id}:${kind}`)
    const status = kind === 'detail' ? (detailStatus.get(id) ?? 200) : 200
    if (status !== 200) return limited({ message: 'stubbed failure' }, status)
    if (kind === 'streams') {
      return limited({
        time: { data: [0, 10, 20, 30] },
        distance: { data: [0, 32, 65, 98] },
        heartrate: id === 3002 ? undefined : { data: [140, 150, 160, 170] },
        cadence: { data: [84, 85, 86, 87] },
        velocity_smooth: { data: [3.2, 3.3, 3.3, 3.2] },
        altitude: { data: [900, 901, 902, 901] },
      })
    }
    return limited({
      id,
      name: detailName.get(id) ?? `Run ${id}`,
      type: 'Run',
      sport_type: 'Run',
      start_date: '2026-11-01T01:00:00Z',
      start_date_local: '2026-11-01T06:30:00Z',
      distance: 6200,
      moving_time: 1820,
      elapsed_time: 1870,
      has_heartrate: id !== 3002,
      ...(id !== 3002 ? { average_heartrate: 150, max_heartrate: 176 } : {}),
      average_cadence: 86,
      calories: 410.6,
      device_name: 'Stub Watch',
      splits_metric: [
        { split: 1, distance: 1000, moving_time: 290, elapsed_time: 295, average_heartrate: 148, elevation_difference: 2, pace_zone: 2 },
        { split: 2, distance: 1000, moving_time: 288, elapsed_time: 288, average_heartrate: 152, elevation_difference: -1, pace_zone: 2 },
      ],
      laps: [{ lap_index: 1, name: 'Lap 1', distance: 6200, moving_time: 1820, elapsed_time: 1870, average_speed: 3.4, max_speed: 4.1, average_heartrate: 150, max_heartrate: 176, average_cadence: 86 }],
      best_efforts: [{ name: '1k', distance: 1000, moving_time: 280, elapsed_time: 280, pr_rank: 1 }],
    })
  })

  const countFor = async (table: string, member: MemberId, ref: string) =>
    ((await payload.db.drizzle.execute(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE member_id = ${member} AND ref = ${ref}`)).rows[0] as { n: number }).n

  readUsage = 78
  const firstDrain = await drainAuthorised()
  expect('drain stops when the read window reaches 80%', firstDrain, { requests: 2, done: 2, retried: 0, dropped: 0, stopped: 'budget' })
  expect('first drain fetched details oldest first', stravaCalls.splice(0), ['3001:detail', '3002:detail'])
  const { rows: detailedRows } = await payload.db.drizzle.execute(sql`
    SELECT calories, device_name, detailed_at IS NOT NULL AS detailed FROM activity_metrics WHERE member_id = ${memberA} AND ref = 'strava:3001'
  `)
  expect('detail job stored calories and device', detailedRows[0], { calories: 411, device_name: 'Stub Watch', detailed: true })
  expect('detail job stored 2 splits, 1 lap and 1 best effort', [
    await countFor('activity_splits', memberA, 'strava:3001'),
    await countFor('activity_laps', memberA, 'strava:3001'),
    await countFor('activity_best_efforts', memberA, 'strava:3001'),
  ], [2, 1, 1])
  const { rows: lapRows } = await payload.db.drizzle.execute(sql`SELECT avg_cadence_spm, avg_hr FROM activity_laps WHERE member_id = ${memberA} AND ref = 'strava:3001'`)
  expect('lap cadence is doubled too', lapRows[0], { avg_cadence_spm: 172, avg_hr: 150 })

  readUsage = 0
  detailStatus.set(3004, 500)
  const secondDrain = await drainAuthorised()
  expect('second drain retries the failing detail, stores two streams, then finds nothing due', secondDrain, { requests: 3, done: 2, retried: 1, dropped: 0, stopped: 'empty' })
  expect('a later detail job runs before earlier streams jobs, and streams wait for their own detail', stravaCalls.splice(0), ['3004:detail', '3001:streams', '3002:streams'])
  const { rows: backoffRows } = await payload.db.drizzle.execute(sql`
    SELECT attempts, last_error, not_before > now() + interval '10 minutes' AS backed_off FROM strava_jobs WHERE strava_activity_id = 3004 AND kind = 'detail'
  `)
  expect('failed detail job backs off with its error recorded', backoffRows[0], { attempts: 1, last_error: 'HTTP 500', backed_off: true })
  const { rows: streamRows } = await payload.db.drizzle.execute(sql`
    SELECT ref, time_s, cadence_spm, heartrate_bpm FROM activity_streams WHERE member_id = ${memberA} ORDER BY ref
  `)
  expect('streams stored as arrays with cadence doubled', streamRows[0], { ref: 'strava:3001', time_s: [0, 10, 20, 30], cadence_spm: [168, 170, 172, 174], heartrate_bpm: [140, 150, 160, 170] })
  expect('streams for a run without heart rate store none', (streamRows[1] as { heartrate_bpm: unknown } | undefined)?.heartrate_bpm, null)

  await payload.db.drizzle.execute(sql`UPDATE strava_jobs SET not_before = now() WHERE strava_activity_id = 3004 AND kind = 'detail'`)
  detailStatus.set(3004, 429)
  const limitedDrain = await drainAuthorised()
  expect('a 429 stops the drain at once', limitedDrain, { requests: 1, done: 0, retried: 0, dropped: 0, stopped: 'rate_limited' })
  const { rows: afterLimit } = await payload.db.drizzle.execute(sql`SELECT attempts, not_before <= now() AS due FROM strava_jobs WHERE strava_activity_id = 3004 AND kind = 'detail'`)
  expect('a 429 hands the job back without counting an attempt', afterLimit[0], { attempts: 1, due: true })
  stravaCalls.splice(0)

  await payload.db.drizzle.execute(sql`UPDATE strava_jobs SET attempts = ${MAX_JOB_ATTEMPTS - 1} WHERE strava_activity_id = 3004 AND kind = 'detail'`)
  detailStatus.set(3004, 503)
  const giveUpDrain = await drainAuthorised()
  expect('a job failing its last attempt is dropped, which frees its streams job', giveUpDrain, { requests: 2, done: 1, retried: 0, dropped: 1, stopped: 'empty' })
  expect('queue is empty once everything is done or dropped', (await jobsOf(memberA)).length, 0)
  stravaCalls.splice(0)

  detailName.set(3001, 'Renamed on Strava')
  await webhookPost(
    new Request('http://localhost:3000/api/v1/strava/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_type: 'activity', aspect_type: 'update', object_id: 3001, owner_id: athleteIdMain, updates: { title: 'Renamed on Strava' } }),
    }),
  )
  const updateDrain = await drainAuthorised()
  expect('an update webhook costs one detail fetch and no stream refetch', [updateDrain.requests, stravaCalls.splice(0)], [1, ['3001:detail']])
  const { rows: renamed } = await payload.db.drizzle.execute(sql`SELECT note FROM activities WHERE member_id = ${memberA} AND ref = 'strava:3001'`)
  expect('the update renamed the run', (renamed[0] as { note: string } | undefined)?.note, 'Renamed on Strava')
  expect('refetching a detail replaces splits instead of duplicating them', await countFor('activity_splits', memberA, 'strava:3001'), 2)

  const detailRes = await run('runDetail', callerA, { source: 'strava', ref: 'strava:3001' })
  expect('runDetail returns the run with metrics, splits, laps and efforts', detailRes.ok && [detailRes.data.run.ref, detailRes.data.metrics?.cadence, detailRes.data.splits.length, detailRes.data.laps.length, detailRes.data.bestEfforts.length], ['strava:3001', 172, 2, 1, 1])
  expect('runDetail downsamples streams for charts', detailRes.ok && detailRes.data.charts?.heartRate, [140, 150, 160, 170])
  expect('heart-rate zones use the highest max_hr on record as the estimated maximum', detailRes.ok && detailRes.data.zones?.estimatedMaxHr, 176)
  expect('runDetail is not syncing once the queue is empty', detailRes.ok && detailRes.data.syncing, false)
  if (detailRes.ok) {
    const html = renderToStaticMarkup(React.createElement(RunDetailBody, { detail: detailRes.data, viewer: 'self' }))
    expect('detail page draws four inline SVG charts', (html.match(/<svg/g) ?? []).length, 4)
    expect('detail page shows a splits table, zone estimate label and best efforts', [html.includes('<table'), html.includes('not a tested maximum'), html.includes('Personal best')], [true, true, true])
    const chartPaths = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1] ?? '')
    expect('every chart path starts with a move and has points', chartPaths.every((d) => /^M[\d.]+ [\d.]+L/.test(d)), true)
  }
  const strangerRes = await run('runDetail', { ...callerA, session: { ...callerA.session, member: memberC0 } }, { source: 'strava', ref: 'strava:3001' })
  expect('another member cannot open the run', strangerRes.ok ? 'ok' : strangerRes.error.code, 'not_found')
  const junkRes = await run('runDetail', callerA, { source: 'strava', ref: "strava:1' OR '1'='1" })
  expect('a malformed run key is refused before the database', junkRes.ok ? 'ok' : junkRes.error.code, 'invalid')
  await queueStravaJob(payload.db.drizzle, memberA, 3001 as StravaActivityId, 'streams')
  const syncingRes = await run('runDetail', callerA, { source: 'strava', ref: 'strava:3001' })
  expect('runDetail reports syncing while a job for the run is queued', syncingRes.ok && syncingRes.data.syncing, true)
  await payload.db.drizzle.execute(sql`DELETE FROM strava_jobs WHERE strava_activity_id = 3001`)

  await queueStravaJob(payload.db.drizzle, memberA, 3002 as StravaActivityId, 'detail')
  detailStatus.set(3002, 404)
  await drainAuthorised()
  expect('a run Strava no longer shows us is removed with its metrics', [
    await countFor('activities', memberA, 'strava:3002'),
    await countFor('activity_metrics', memberA, 'strava:3002'),
    await countFor('activity_streams', memberA, 'strava:3002'),
  ], [0, 0, 0])

  await payload.db.drizzle.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s) VALUES (${memberA}, 'strava', 'strava:3010', '2026-11-04', 5000, 1500)
  `)
  readUsage = 0
  stravaCalls.splice(0)
  await queueStravaJob(payload.db.drizzle, memberA, 3010 as StravaActivityId, 'detail')
  await queueStravaJob(payload.db.drizzle, memberA, 3011 as StravaActivityId, 'detail')
  await queueStravaJob(payload.db.drizzle, memberA, 3012 as StravaActivityId, 'detail')
  const capped = await drainStravaJobs(payload, 2)
  expect('a drain stops at its request cap when headers allow more', [capped.requests, capped.stopped], [2, 'request_cap'])
  await payload.db.drizzle.execute(sql`DELETE FROM strava_jobs WHERE strava_activity_id IN (3010, 3011, 3012)`)
  await queueStravaJob(payload.db.drizzle, memberA, 3001 as StravaActivityId, 'streams')

  // ============================================================================
  // 7. Disconnect via disconnectStrava
  // ============================================================================
  console.log('\n--- 7. Disconnect via disconnectStrava ---')
  const disconnectRes = await run('disconnectStrava', callerA, {})
  expect('disconnectStrava action succeeds', disconnectRes.ok, true)

  const { rows: aConnAfterDisconnect } = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM strava_connections WHERE member_id = ${memberA}
  `)
  expect('disconnectStrava purged strava_connections row', aConnAfterDisconnect.length, 0)

  const { rows: aActAfterDisconnect } = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM activities WHERE member_id = ${memberA} AND source = 'strava'
  `)
  expect('disconnectStrava purged all Strava activities for member', aActAfterDisconnect.length, 0)
  const { rows: aLeftovers } = await payload.db.drizzle.execute(sql`
    SELECT
      (SELECT count(*)::int FROM activity_metrics WHERE member_id = ${memberA}) AS metrics,
      (SELECT count(*)::int FROM activity_splits WHERE member_id = ${memberA}) AS splits,
      (SELECT count(*)::int FROM activity_laps WHERE member_id = ${memberA}) AS laps,
      (SELECT count(*)::int FROM activity_best_efforts WHERE member_id = ${memberA}) AS efforts,
      (SELECT count(*)::int FROM activity_streams WHERE member_id = ${memberA}) AS streams,
      (SELECT count(*)::int FROM strava_jobs WHERE member_id = ${memberA}) AS jobs
  `)
  expect('disconnect leaves no metric, split, lap, effort, stream or job rows', aLeftovers[0], { metrics: 0, splits: 0, laps: 0, efforts: 0, streams: 0, jobs: 0 })

  const statusAfterDisconnect = await getStravaStatus(payload, memberA)
  expect('status is disconnected after disconnectStrava', statusAfterDisconnect.status, 'disconnected')
  expect('athleteId is null after disconnectStrava', statusAfterDisconnect.athleteId, null)
  expect('lastSyncedAt is null after disconnectStrava', statusAfterDisconnect.lastSyncedAt, null)

  // ============================================================================
  // 8. Privacy isolation: PUBLIC_SOURCES query and athleteWeek
  // ============================================================================
  console.log('\n--- 8. Privacy isolation ---')
  // 8a. Verify domain constant PUBLIC_SOURCES excludes 'strava'
  expect('PUBLIC_SOURCES does not include strava', (PUBLIC_SOURCES as readonly string[]).includes('strava'), false)
  expect('PUBLIC_SOURCES includes manual', PUBLIC_SOURCES.includes('manual'), true)
  expect('PUBLIC_SOURCES includes file', PUBLIC_SOURCES.includes('file'), true)

  // 8b. Create member C, coach, and athlete profile to test query and coach view isolation
  const memberC = await createTestMember('privacy-c')
  const coachMember = await createTestMember('privacy-coach')

  const coachSlug = `coach-privacy-${runId}` as Slug
  const { rows: coachRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO coaches (name, slug, credentials, member_id, _status)
    VALUES ('Privacy Coach', ${coachSlug}, 'Head Coach', ${coachMember}, 'published')
    RETURNING id
  `)
  testCoachId = (coachRows[0] as { id: number }).id as CoachId

  const athleteSlug = `athlete-privacy-${runId}` as Slug
  const { rows: athleteRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO athletes (name, slug, member_id, home_subdivision, visibility_profile, visibility_results, visibility_mileage, moderation_state)
    VALUES ('Privacy Athlete', ${athleteSlug}, ${memberC}, 'IN-KA', 'public', 'public', 'public', 'approved')
    RETURNING id
  `)
  testAthleteId = (athleteRows[0] as { id: number }).id

  // Create active coaching link
  const { rows: linkRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO coaching_links (athlete_member_id, coach_id, state, requested_at, decided_at)
    VALUES (${memberC}, ${testCoachId}, 'active', now(), now())
    RETURNING id
  `)
  testLinkId = String((linkRows[0] as { id: string | number }).id)

  const today = todayIn(CLUB_TIME_ZONE)
  const weekStart = weekOf(today).first

  // Insert 1 manual activity (10,000m) and 1 strava activity (25,000m) for member C on today
  await payload.db.drizzle.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, note)
    VALUES
      (${memberC}, 'manual', 'manual-privacy-run', ${today}, 10000, 3000, 'Legitimate Club Tempo'),
      (${memberC}, 'strava', 'strava:777001', ${today}, 25000, 7500, 'Private Strava Long Run')
  `)

  // Test SQL query using PUBLIC_SOURCES
  const { rows: publicSourceRows } = await payload.db.drizzle.execute(sql`
    SELECT source, ref, metres FROM activities
    WHERE member_id = ${memberC}
      AND source IN ('manual', 'file')
  `)
  expect('PUBLIC_SOURCES query returns only the manual activity', publicSourceRows.length, 1)
  const publicAct = publicSourceRows[0] as { source: string; ref: string; metres: number } | undefined
  expect('PUBLIC_SOURCES result is manual source', publicAct?.source, 'manual')
  expect('PUBLIC_SOURCES result metres is 10000', publicAct?.metres, 10000)

  // Verify that a query for ALL activities finds both
  const { rows: allMemberCRows } = await payload.db.drizzle.execute(sql`
    SELECT count(*)::int AS count FROM activities WHERE member_id = ${memberC}
  `)
  const countRow = allMemberCRows[0] as { count: number } | undefined
  expect('database holds both activities for member', countRow?.count, 2)

  // Coach views athleteWeek: athleteWeek query explicitly enforces source IN ('manual', 'file')
  const coachSession = (await issueSession(payload, coachMember, 'cookie', 'Coach Browser')).token
  const coachCaller: Caller = {
    kind: 'member',
    session: (await resolveSession(payload, coachSession, 'cookie'))!,
    sender: '127.0.0.1',
  }

  const athleteWeekRes = await run('athleteWeek', coachCaller, {
    athleteSlug,
    weekStart,
  })
  expect('coach athleteWeek succeeds', athleteWeekRes.ok, true)
  if (athleteWeekRes.ok) {
    const data = athleteWeekRes.data
    expect('athleteWeek runs list excludes Strava run (count is 1)', data.runs.length, 1)
    expect('athleteWeek run is the manual run', data.runs[0]?.ref, 'manual-privacy-run')
    expect('athleteWeek summary runCount is 1', data.summary.runCount, 1)
    expect('athleteWeek summary totalMetres is exactly 10000 (excludes 25000m Strava run)', data.summary.totalMetres, 10000)
  }

  const coachRunDetail = (ref: string) => run('athleteRunDetail', coachCaller, { athleteSlug, source: 'strava', ref })
  const hiddenDetail = await coachRunDetail('strava:777001')
  expect('with the coach view off, a coach cannot open the Strava run', hiddenDetail.ok ? 'ok' : hiddenDetail.error.code, 'not_found')
  const rosterOff = await run('roster', coachCaller, {})
  expect('with the coach view off, the roster counts only the manual run', rosterOff.ok && rosterOff.data.athletes.find((a) => a.athleteSlug === athleteSlug)?.totalMetres, 10000)

  process.env.STRAVA_COACH_VIEW = 'true'
  const weekOn = await run('athleteWeek', coachCaller, { athleteSlug, weekStart })
  expect('with the coach view on, athleteWeek includes the Strava run', weekOn.ok && [weekOn.data.runs.length, weekOn.data.summary.totalMetres], [2, 35000])
  const rosterOn = await run('roster', coachCaller, {})
  expect('with the coach view on, the roster counts the Strava run', rosterOn.ok && rosterOn.data.athletes.find((a) => a.athleteSlug === athleteSlug)?.totalMetres, 35000)
  const shownDetail = await coachRunDetail('strava:777001')
  expect('with the coach view on, the coach opens the Strava run detail', shownDetail.ok && [shownDetail.data.run.ref, shownDetail.data.run.distance], ['strava:777001', 25000])
  const missingDetail = await coachRunDetail('strava:777002')
  expect('a coach asking for a run the athlete does not have gets not_found', missingDetail.ok ? 'ok' : missingDetail.error.code, 'not_found')

  const otherCoachMember = await createTestMember('other-coach')
  const { rows: otherCoachRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO coaches (name, slug, credentials, member_id, _status)
    VALUES ('Other Coach', ${`coach-other-${runId}`}, 'Coach', ${otherCoachMember}, 'published')
    RETURNING id
  `)
  otherCoachId = (otherCoachRows[0] as { id: number }).id as CoachId
  const otherCoachCaller: Caller = {
    kind: 'member',
    session: (await resolveSession(payload, (await issueSession(payload, otherCoachMember, 'cookie', 'Other Coach')).token, 'cookie'))!,
    sender: '127.0.0.1',
  }
  const unlinkedDetail = await run('athleteRunDetail', otherCoachCaller, { athleteSlug, source: 'strava', ref: 'strava:777001' })
  expect('a coach without an active link to the athlete is refused', unlinkedDetail.ok ? 'ok' : unlinkedDetail.error.code, 'forbidden')
  const athleteAsCoach = await run('athleteRunDetail', { kind: 'member', session: (await resolveSession(payload, (await issueSession(payload, memberC, 'cookie', 'Athlete')).token, 'cookie'))!, sender: '127.0.0.1' }, { athleteSlug, source: 'strava', ref: 'strava:777001' })
  expect('a member who is not a coach cannot use the coach operation', athleteAsCoach.ok ? 'ok' : athleteAsCoach.error.code, 'forbidden')

  expect('with the coach view on, PUBLIC_SOURCES still excludes strava', (PUBLIC_SOURCES as readonly string[]).includes('strava'), false)
  const { rows: publicRowsFlagOn } = await payload.db.drizzle.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(metres), 0)::int AS metres FROM activities WHERE member_id = ${memberC} AND source IN ${sql`(${sql.join(PUBLIC_SOURCES.map((source) => sql`${source}`), sql`, `)})`}
  `)
  expect('a board built from PUBLIC_SOURCES counts only the manual run with the coach view on', publicRowsFlagOn[0], { n: 1, metres: 10000 })
  delete process.env.STRAVA_COACH_VIEW
} finally {
  // Restore global fetch
  globalThis.fetch = originalFetch

  // Cleanup test data
  try {
    if (testLinkId) {
      await payload.db.drizzle.execute(sql`DELETE FROM week_reviews WHERE link_id = ${testLinkId}`)
      await payload.db.drizzle.execute(sql`DELETE FROM coaching_links WHERE id = ${testLinkId}`)
    }
    if (testAthleteId) {
      await payload.db.drizzle.execute(sql`DELETE FROM athletes WHERE id = ${testAthleteId}`)
    }
    if (testCoachId) {
      await payload.db.drizzle.execute(sql`DELETE FROM coaches WHERE id = ${testCoachId}`)
    }
    if (otherCoachId) {
      await payload.db.drizzle.execute(sql`DELETE FROM coaches WHERE id = ${otherCoachId}`)
    }
    if (createdMemberIds.length > 0) {
      await payload.db.drizzle.execute(
        sql`DELETE FROM check_ins WHERE member_id IN ${sql`(${sql.join(createdMemberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
      await payload.db.drizzle.execute(
        sql`DELETE FROM strava_connections WHERE member_id IN ${sql`(${sql.join(createdMemberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
      await payload.db.drizzle.execute(
        sql`DELETE FROM activities WHERE member_id IN ${sql`(${sql.join(createdMemberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
      await payload.db.drizzle.execute(
        sql`DELETE FROM member_sessions WHERE member_id IN ${sql`(${sql.join(createdMemberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
      await payload.db.drizzle.execute(
        sql`DELETE FROM members WHERE id IN ${sql`(${sql.join(createdMemberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
    }
  } catch (err) {
    console.error('Cleanup error:', err)
  }
}

console.log(`\ncheck-strava: ${passes} passed, ${failures.length} failed`)
if (failures.length > 0) {
  process.exit(1)
}
process.exit(0)
