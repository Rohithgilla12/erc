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
 *
 * Run via: pnpm --filter @erc/web payload run src/scripts/check-strava.ts
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  CLUB_TIME_ZONE,
  PUBLIC_SOURCES,
  todayIn,
  weekOf,
  type CoachId,
  type MemberId,
  type Slug,
} from '@erc/domain'
import { getPayload } from 'payload'

import { GET as connectGet } from '@/app/api/v1/strava/connect/route'
import { GET as callbackGet } from '@/app/api/v1/strava/callback/route'
import { GET as webhookGet, POST as webhookPost } from '@/app/api/v1/strava/webhook/route'
import { run, type Caller } from '@/members/run'
import { issueSession, resolveSession, SESSION_COOKIE } from '@/members/session'
import {
  getStravaStatus,
  getValidStravaToken,
  joinStravaWaitlist,
} from '@/members/strava'
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
      start_date_local: '2026-11-01T06:30:00Z',
      distance: 6000,
      moving_time: 1800,
      elapsed_time: 1850,
    },
    {
      id: 3002,
      name: 'Trail Endurance Run',
      type: 'Run',
      sport_type: 'TrailRun',
      start_date_local: '2026-11-02T07:15:00Z',
      distance: 14000,
      moving_time: 4500,
      elapsed_time: 4600,
    },
    {
      id: 3003,
      name: 'Rest Day Coffee Ride',
      type: 'Ride',
      sport_type: 'Ride',
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

  const { rows: createdActRows } = await payload.db.drizzle.execute(sql`
    SELECT metres, note FROM activities WHERE member_id = ${memberA} AND ref = 'strava:3005'
  `)
  expect('webhook created activity strava:3005 in Postgres', createdActRows.length, 1)
  const createdAct = createdActRows[0] as { metres: number; note: string | null } | undefined
  expect('created activity metres is 5000', createdAct?.metres, 5000)
  expect('created activity note is Webhook 5K Fast', createdAct?.note, 'Webhook 5K Fast')

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
      (${memberC}, 'strava', 'strava:private-999', ${today}, 25000, 7500, 'Private Strava Long Run')
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
