/**
 * Proves who can read an intake: the owner always, their coach only through an active link and only while they share
 * it, nobody else. Also proves consent is required, clearing works, and deleting the member deletes the row.
 * Run via: pnpm --filter @erc/web payload run src/scripts/check-intake.ts
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import type { CoachId, MemberId } from '@erc/domain'
import { getPayload } from 'payload'

import { run, type Caller } from '@/members/run'
import { issueSession, resolveSession } from '@/members/session'

const payload = await getPayload({ config })
const db = payload.db.drizzle
const runId = Date.now()
let passes = 0
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  if (JSON.stringify(actual) === JSON.stringify(wanted)) {
    passes++
    console.log(`PASS ${label}`)
  } else {
    failures.push(label)
    console.log(`FAIL ${label}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`)
  }
}

const memberIds: MemberId[] = []
const coachIds: CoachId[] = []
const athleteIds: number[] = []

const newMember = async (name: string): Promise<MemberId> => {
  const { rows } = await db.execute(sql`INSERT INTO members (email, age_declared_at) VALUES (${`check-intake-${name}-${runId}@example.com`}, now()) RETURNING id`)
  const id = (rows[0] as { id: number }).id as MemberId
  memberIds.push(id)
  return id
}

const newCoach = async (member: MemberId, name: string): Promise<CoachId> => {
  const { rows } = await db.execute(sql`
    INSERT INTO coaches (name, slug, member_id, _status) VALUES (${`Coach ${name} ${runId}`}, ${`check-intake-coach-${name}-${runId}`}, ${member}, 'published') RETURNING id
  `)
  const id = (rows[0] as { id: number }).id as CoachId
  coachIds.push(id)
  return id
}

const callerFor = async (member: MemberId): Promise<Caller> => {
  const token = (await issueSession(payload, member, 'cookie', 'Check browser')).token
  return { kind: 'member', session: (await resolveSession(payload, token, 'cookie'))!, sender: '127.0.0.1' }
}

const answers = {
  birthYear: '1988',
  goal: 'first_race',
  goalDetail: 'Finish the Bengaluru 10K',
  weeklyKm: '18',
  recent5k: '31:20',
  recent10k: '',
  sleepHours: '6.5',
  sleepQuality: 'poor',
  nutrition: 'irregular',
  healthCondition: 'cardiovascular',
  healthNotes: 'Controlled blood pressure',
  injuries: 'Left knee ache on stairs',
  medications: '',
}

const intakeRows = async (member: MemberId) => {
  const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM intakes WHERE member_id = ${member}`)
  return (rows[0] as { n: number }).n
}

try {
  const athleteMember = await newMember('athlete')
  const otherMember = await newMember('other')
  const coachMember = await newMember('coach')
  const strangerCoachMember = await newMember('stranger')
  const coachId = await newCoach(coachMember, 'linked')
  const strangerCoachId = await newCoach(strangerCoachMember, 'stranger')

  const athleteSlug = `check-intake-athlete-${runId}`
  const { rows: athleteRows } = await db.execute(sql`
    INSERT INTO athletes (name, slug, member_id, home_subdivision, visibility_profile, visibility_results, visibility_mileage, moderation_state)
    VALUES (${`Intake Athlete ${runId}`}, ${athleteSlug}, ${athleteMember}, 'IN-KA', 'hidden', 'hidden', 'hidden', 'approved')
    RETURNING id
  `)
  athleteIds.push((athleteRows[0] as { id: number }).id)

  const athlete = await callerFor(athleteMember)
  const other = await callerFor(otherMember)
  const coach = await callerFor(coachMember)
  const strangerCoach = await callerFor(strangerCoachMember)
  const anonymous: Caller = { kind: 'anonymous', carrier: 'cookie', sender: '127.0.0.1', rejectedToken: false }

  expect('a new member has no intake', await run('myIntake', athlete, {}), { ok: true, data: null })
  const anonRead = await run('myIntake', anonymous, {})
  expect('an anonymous caller is told to sign in', !anonRead.ok && anonRead.error.code, 'unauthenticated')

  const noConsent = await run('saveIntake', athlete, { answers, shareWithCoach: 'on' })
  expect('a save without consent is refused on the consent field', !noConsent.ok && noConsent.error.fields?.consent !== undefined, true)
  const stray = await run('saveIntake', athlete, { answers: { ...answers, bloodType: 'O+' }, consent: 'on' })
  expect('an answer to no question is refused', !stray.ok && stray.error.fields?.bloodType, 'This is not an intake question.')
  const badTime = await run('saveIntake', athlete, { answers: { ...answers, recent5k: '31.20' }, consent: 'on' })
  expect('a malformed time is refused on its field', !badTime.ok && Object.keys(badTime.error.fields ?? {}), ['recent5k'])
  expect('refused saves store nothing', await intakeRows(athleteMember), 0)

  const saved = await run('saveIntake', athlete, { answers, consent: 'on' })
  expect('the owner saves an intake', saved.ok, true)
  expect('sharing defaults to off', saved.ok && saved.data.shareWithCoach, false)
  const mine = await run('myIntake', athlete, {})
  expect('the owner reads the answers back as typed values', mine.ok && mine.data && [mine.data.answers.recent5k, mine.data.answers.sleepHours, mine.data.answers.recent10k], [1880, 6.5, null])
  expect('the owner reads the health answers', mine.ok && mine.data?.answers.healthCondition, 'cardiovascular')

  const othersView = await run('myIntake', other, {})
  expect('another member reads only their own, empty, intake', othersView.ok && othersView.data, null)
  const otherAsCoach = await run('athleteIntake', other, { athleteSlug })
  expect('a member who is not a coach cannot use the coach read', !otherAsCoach.ok && otherAsCoach.error.code, 'forbidden')

  const unlinked = await run('athleteIntake', coach, { athleteSlug })
  expect('a coach with no link cannot read', !unlinked.ok && unlinked.error.code, 'forbidden')

  await run('saveIntake', athlete, { answers, consent: 'on', shareWithCoach: 'on' })
  expect('sharing does not open the intake to a coach without a link', (await run('athleteIntake', coach, { athleteSlug })).ok, false)

  await run('requestCoach', athlete, { coachId })
  const requested = await run('athleteIntake', coach, { athleteSlug })
  expect('a coach with only a requested link cannot read', !requested.ok && requested.error.code, 'forbidden')

  const roster = await run('roster', coach, {})
  const linkId = roster.ok ? roster.data.pendingRequests[0]?.linkId : undefined
  await run('decideCoachingRequest', coach, { linkId: linkId ?? '', decision: 'accept' })

  const shared = await run('athleteIntake', coach, { athleteSlug })
  expect('the linked coach reads a shared intake', shared.ok && shared.data.shared, true)
  expect('the linked coach sees the injury', shared.ok && shared.data.shared && shared.data.answers.injuries, 'Left knee ache on stairs')
  const stranger = await run('athleteIntake', strangerCoach, { athleteSlug })
  expect('another coach still cannot read', !stranger.ok && stranger.error.code, 'forbidden')

  await run('saveIntake', athlete, { answers, consent: 'on' })
  expect('turning sharing off hides it from the coach at once', await run('athleteIntake', coach, { athleteSlug }), { ok: true, data: { shared: false } })

  await run('saveIntake', athlete, { answers, consent: 'on', shareWithCoach: 'on' })
  const cleared = await run('clearIntake', athlete, {})
  expect('the owner clears the intake', cleared.ok && cleared.data, { cleared: true })
  expect('a cleared intake is gone for the owner', await run('myIntake', athlete, {}), { ok: true, data: null })
  expect('a cleared intake is not shared, and looks the same as one never shared', await run('athleteIntake', coach, { athleteSlug }), { ok: true, data: { shared: false } })
  expect('clearing again still succeeds', (await run('clearIntake', athlete, {})).ok, true)

  await run('saveIntake', athlete, { answers, consent: 'on', shareWithCoach: 'on' })
  await run('endCoaching', athlete, {})
  const ended = await run('athleteIntake', coach, { athleteSlug })
  expect('ending the link hides a shared intake from the coach', !ended.ok && ended.error.code, 'forbidden')

  expect('the row exists before the member is deleted', await intakeRows(athleteMember), 1)
  await db.execute(sql`DELETE FROM athletes WHERE member_id = ${athleteMember}`)
  await db.execute(sql`DELETE FROM members WHERE id = ${athleteMember}`)
  expect('deleting the member deletes the intake', await intakeRows(athleteMember), 0)
} finally {
  try {
    if (athleteIds.length > 0) await db.execute(sql`DELETE FROM athletes WHERE id IN ${sql`(${sql.join(athleteIds.map((id) => sql`${id}`), sql`, `)})`}`)
    if (coachIds.length > 0) await db.execute(sql`DELETE FROM coaches WHERE id IN ${sql`(${sql.join(coachIds.map((id) => sql`${id}`), sql`, `)})`}`)
    if (memberIds.length > 0) {
      const ids = sql`(${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`
      await db.execute(sql`DELETE FROM member_sessions WHERE member_id IN ${ids}`)
      await db.execute(sql`DELETE FROM members WHERE id IN ${ids}`)
    }
  } catch (error) {
    console.error('Cleanup error:', error)
  }
}

console.log(`check-intake: ${passes} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
