/**
 * Automated end-to-end check script for coaching and athlete view.
 * Proves session coach resolution, coaching requests, roster, check-ins, runs with notes, week review, and access control.
 * Run via: pnpm --filter @erc/web payload run src/scripts/check-coaching.ts
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { CLUB_TIME_ZONE, todayIn, weekOf, type CoachId, type MemberId, type Slug } from '@erc/domain'
import { getPayload } from 'payload'

import { issueSession, resolveSession } from '@/members/session'
import { run, type Caller } from '@/members/run'

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

let coachMemberId: MemberId | null = null
let athleteMemberId: MemberId | null = null
let coachId: CoachId | null = null
let athleteId: number | null = null
let createdLinkId: string | null = null

try {
  // 1. Create coach member and athlete member
  const coachEmail = `check-coach-${runId}@example.com`
  const { rows: coachMemberRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO members (email, age_declared_at) VALUES (${coachEmail}, now()) RETURNING id
  `)
  coachMemberId = (coachMemberRows[0] as { id: number }).id as MemberId

  const athleteEmail = `check-athlete-${runId}@example.com`
  const { rows: athleteMemberRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO members (email, age_declared_at) VALUES (${athleteEmail}, now()) RETURNING id
  `)
  athleteMemberId = (athleteMemberRows[0] as { id: number }).id as MemberId

  // 2. Create published coach record linked to coachMemberId
  const coachSlug = `check-coach-slug-${runId}`
  const { rows: coachRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO coaches (name, slug, credentials, member_id, _status)
    VALUES (${`Coach ${runId}`}, ${coachSlug}, 'USATF Level 2 Coach', ${coachMemberId}, 'published')
    RETURNING id
  `)
  coachId = (coachRows[0] as { id: number }).id as CoachId

  // 3. Create approved athlete record linked to athleteMemberId
  const athleteSlug = `check-athlete-slug-${runId}` as Slug
  const { rows: athleteRows } = await payload.db.drizzle.execute(sql`
    INSERT INTO athletes (name, slug, member_id, home_subdivision, visibility_profile, visibility_results, visibility_mileage, moderation_state)
    VALUES (${`Athlete ${runId}`}, ${athleteSlug}, ${athleteMemberId}, 'IN-KA', 'public', 'public', 'public', 'approved')
    RETURNING id
  `)
  athleteId = (athleteRows[0] as { id: number }).id

  // 4. Issue and resolve sessions
  const coachToken = (await issueSession(payload, coachMemberId, 'cookie', 'Coach Browser')).token
  const coachSession = await resolveSession(payload, coachToken, 'cookie')
  expect('coach session resolves coachId', coachSession?.coachId, coachId)

  const athleteToken = (await issueSession(payload, athleteMemberId, 'cookie', 'Athlete Browser')).token
  const athleteSession = await resolveSession(payload, athleteToken, 'cookie')
  expect('athlete session has null coachId', athleteSession?.coachId, null)

  const coachCaller: Caller = { kind: 'member', session: coachSession!, sender: '127.0.0.1' }
  const athleteCaller: Caller = { kind: 'member', session: athleteSession!, sender: '127.0.0.1' }
  const anonCaller: Caller = { kind: 'anonymous', carrier: 'cookie', sender: '127.0.0.1', rejectedToken: false }

  // 5. Access control: non-coach and anonymous callers cannot call coach endpoints
  const athleteRoster = await run('roster', athleteCaller, {})
  expect('non-coach caller cannot access roster', athleteRoster.ok, false)
  if (!athleteRoster.ok) {
    expect('non-coach caller gets forbidden error', athleteRoster.error.code, 'forbidden')
  }

  const anonRoster = await run('roster', anonCaller, {})
  expect('anon caller cannot access roster', anonRoster.ok, false)
  if (!anonRoster.ok) {
    expect('anon caller gets forbidden error', anonRoster.error.code, 'forbidden')
  }

  // 6. Test 1: Athlete checks initial coaching and requests coach
  const initialCoaching = await run('myCoaching', athleteCaller, {})
  expect('initial myCoaching is ok', initialCoaching.ok, true)
  if (initialCoaching.ok) {
    expect('initial coaching link is null', initialCoaching.data.link, null)
    expect('availableCoaches includes created coach', initialCoaching.data.availableCoaches?.some((c) => c.id === coachId), true)
  }

  const reqRes = await run('requestCoach', athleteCaller, { coachId })
  expect('athlete requestCoach succeeds', reqRes.ok, true)
  if (reqRes.ok) {
    expect('requestCoach returned requested: true', reqRes.data.requested, true)
  }

  // Duplicate request should fail with conflict
  const dupReq = await run('requestCoach', athleteCaller, { coachId })
  expect('duplicate requestCoach fails with conflict', !dupReq.ok && dupReq.error.code, 'conflict')

  const myCoachingAfterReq = await run('myCoaching', athleteCaller, {})
  expect('myCoaching shows requested state', myCoachingAfterReq.ok && myCoachingAfterReq.data.link?.state, 'requested')

  // 7. Test 2: Coach checks roster -> sees pending request
  const rosterRes = await run('roster', coachCaller, {})
  expect('coach roster succeeds', rosterRes.ok, true)
  if (rosterRes.ok) {
    expect('roster pendingRequests length is 1', rosterRes.data.pendingRequests.length, 1)
    expect('roster athletes length is 0', rosterRes.data.athletes.length, 0)
    const item = rosterRes.data.pendingRequests[0]!
    expect('pending request athleteMember matches', item.athleteMember, String(athleteMemberId))
    expect('pending request athleteSlug matches', item.athleteSlug, athleteSlug)
    createdLinkId = item.linkId
  }

  // 8. Test 3: Coach accepts request -> link becomes active
  expect('linkId exists before accepting', Boolean(createdLinkId), true)
  if (createdLinkId) {
    const decideRes = await run('decideCoachingRequest', coachCaller, { linkId: createdLinkId, decision: 'accept' })
    expect('coach decides request with accept', decideRes.ok, true)

    const rosterAfterAccept = await run('roster', coachCaller, {})
    if (rosterAfterAccept.ok) {
      expect('roster pendingRequests is now empty', rosterAfterAccept.data.pendingRequests.length, 0)
      expect('roster athletes has 1 item', rosterAfterAccept.data.athletes.length, 1)
      expect('active athlete linkId matches', rosterAfterAccept.data.athletes[0]?.linkId, createdLinkId)
      expect('active athlete state is active', rosterAfterAccept.data.athletes[0]?.state, 'active')
    }
  }

  // 9. Test 4: Athlete logs run with note
  const today = todayIn(CLUB_TIME_ZONE)
  const logRes = await run('logRun', athleteCaller, {
    date: today,
    distanceKm: '10',
    duration: '50:00',
    note: 'Felt strong, cool morning tempo',
  })
  expect('athlete logs run with note', logRes.ok, true)
  if (logRes.ok) {
    expect('logRun persists note', logRes.data.note, 'Felt strong, cool morning tempo')
    expect('logRun distance is 10000m', logRes.data.distance, 10000)
  }

  const listRunsRes = await run('listRuns', athleteCaller, {})
  if (listRunsRes.ok) {
    expect('listRuns includes run note', listRunsRes.data.items[0]?.note, 'Felt strong, cool morning tempo')
  }

  // 10. Test 5: Athlete submits weekly check-in
  const checkInRes = await run('submitCheckIn', athleteCaller, {
    feeling: 'tired',
    niggles: 'left hamstring tight',
    note: 'High volume week, resting tomorrow',
  })
  expect('athlete submitCheckIn succeeds', checkInRes.ok, true)
  if (checkInRes.ok) {
    expect('checkIn feeling matches', checkInRes.data.feeling, 'tired')
    expect('checkIn niggles matches', checkInRes.data.niggles, 'left hamstring tight')
    expect('checkIn note matches', checkInRes.data.note, 'High volume week, resting tomorrow')
  }

  // 11. Test 6: Coach views athleteWeek
  const weekStart = weekOf(today).first
  const athleteWeekRes = await run('athleteWeek', coachCaller, {
    athleteSlug,
    weekStart,
  })
  expect('coach views athleteWeek', athleteWeekRes.ok, true)
  if (athleteWeekRes.ok) {
    expect('athleteWeek runs count is 1', athleteWeekRes.data.runs.length, 1)
    expect('athleteWeek run note matches', athleteWeekRes.data.runs[0]?.note, 'Felt strong, cool morning tempo')
    expect('athleteWeek checkIn feeling matches', athleteWeekRes.data.checkIn?.feeling, 'tired')
    expect('athleteWeek summary totalMetres is 10000', athleteWeekRes.data.summary.totalMetres, 10000)
    expect('athleteWeek summary totalSeconds is 3000', athleteWeekRes.data.summary.totalSeconds, 3000)
    expect('athleteWeek summary runCount is 1', athleteWeekRes.data.summary.runCount, 1)
    expect('athleteWeek summary flags include ELEVATED_FATIGUE', athleteWeekRes.data.summary.flags.includes('ELEVATED_FATIGUE'), true)
    expect('athleteWeek summary flags include NIGGLE_REPORTED', athleteWeekRes.data.summary.flags.includes('NIGGLE_REPORTED'), true)
    expect('initial athleteWeek review is null', athleteWeekRes.data.review, null)
  }

  // 12. Test 7: Coach saves week review
  const saveRevRes = await run('saveWeekReview', coachCaller, {
    athleteSlug,
    weekStart,
    watch: ['Monitor left hamstring on warm-up', 'Keep easy runs strictly Zone 2'],
    recommendations: ['Schedule extra sleep', 'Foam roll calves and glutes'],
    note: 'Good job holding pace despite fatigue.',
  })
  expect('coach saveWeekReview succeeds', saveRevRes.ok, true)
  if (saveRevRes.ok) {
    expect('saved review weekStart matches', saveRevRes.data.weekStart, weekStart)
    expect('saved review watch count is 2', saveRevRes.data.watch.length, 2)
    expect('saved review recommendations count is 2', saveRevRes.data.recommendations.length, 2)
    expect('saved review note matches', saveRevRes.data.note, 'Good job holding pace despite fatigue.')
  }

  // 13. Test 8: Athlete views myWeekReview
  const myRevRes = await run('myWeekReview', athleteCaller, { weekStart })
  expect('athlete myWeekReview succeeds', myRevRes.ok, true)
  if (myRevRes.ok && myRevRes.data) {
    expect('athlete sees coach watch item', myRevRes.data.watch[0], 'Monitor left hamstring on warm-up')
    expect('athlete sees coach recommendation', myRevRes.data.recommendations[0], 'Schedule extra sleep')
    expect('athlete sees coach note', myRevRes.data.note, 'Good job holding pace despite fatigue.')
  }

  const myCoachingAfterReview = await run('myCoaching', athleteCaller, {})
  if (myCoachingAfterReview.ok) {
    expect('myCoaching currentReview weekStart matches', myCoachingAfterReview.data.currentReview?.weekStart, weekStart)
  }

  // 14. Test 9: Athlete ends coaching
  const endRes = await run('endCoaching', athleteCaller, {})
  expect('athlete ends coaching relationship', endRes.ok, true)
  if (endRes.ok) {
    expect('endCoaching returned ended: true', endRes.data.ended, true)
  }

  const myCoachingAfterEnd = await run('myCoaching', athleteCaller, {})
  if (myCoachingAfterEnd.ok) {
    expect('myCoaching link is null after ending', myCoachingAfterEnd.data.link, null)
  }

  // 15. Test 10: Subsequent coach access to athleteWeek returns forbidden
  const weekAfterEnd = await run('athleteWeek', coachCaller, {
    athleteSlug,
    weekStart,
  })
  expect('coach access after link ended fails', weekAfterEnd.ok, false)
  if (!weekAfterEnd.ok) {
    expect('coach access rejected with forbidden code', weekAfterEnd.error.code, 'forbidden')
  }
} finally {
  // Cleanup all test records
  try {
    if (createdLinkId) {
      await payload.db.drizzle.execute(sql`DELETE FROM week_reviews WHERE link_id = ${createdLinkId}`)
    }
    if (athleteMemberId) {
      await payload.db.drizzle.execute(sql`DELETE FROM check_ins WHERE member_id = ${athleteMemberId}`)
      await payload.db.drizzle.execute(sql`DELETE FROM coaching_links WHERE athlete_member_id = ${athleteMemberId}`)
      await payload.db.drizzle.execute(sql`DELETE FROM activities WHERE member_id = ${athleteMemberId}`)
    }
    if (athleteId) {
      await payload.db.drizzle.execute(sql`DELETE FROM athletes WHERE id = ${athleteId}`)
    }
    if (coachId) {
      await payload.db.drizzle.execute(sql`DELETE FROM coaches WHERE id = ${coachId}`)
    }
    const memberIds = [coachMemberId, athleteMemberId].filter((id): id is MemberId => id !== null)
    if (memberIds.length > 0) {
      await payload.db.drizzle.execute(
        sql`DELETE FROM member_sessions WHERE member_id IN ${sql`(${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
      await payload.db.drizzle.execute(
        sql`DELETE FROM members WHERE id IN ${sql`(${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`}`,
      )
    }
  } catch (err) {
    console.error('Cleanup error:', err)
  }
}

console.log(`check-coaching: ${passes} passed, ${failures.length} failed`)
if (failures.length > 0) {
  process.exit(1)
}
process.exit(0)
