/**
 * Proves shoe and race reviews and race questions end to end:
 * `ERC_CHECK_URL=<site> ERC_CHECK_LOG=<site log file> pnpm payload run src/scripts/check-reviews.ts`.
 * Forms are posted the way a browser with JavaScript off posts them; the API is called with bearer tokens. The site
 * must share this database, `PAYLOAD_SECRET` and `REVALIDATE_SECRET` (with `ERC_SITE_URL` set here, so staff decisions
 * made in this process expire the site's cache), and write its stdout and stderr to `ERC_CHECK_LOG`, so a failed
 * write can be checked for what it logged. Everything it writes is removed.
 */
import { readFile, stat } from 'node:fs/promises'

import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import type { Envelope } from '@erc/contract'
import { QUESTIONS_PER_HOUR, REVIEWS_PER_HOUR, type CoachId, type Id, type MemberId } from '@erc/domain'
import { getPayload } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'
import { answerQuestion, askQuestion } from '@/members/reviews'
import { issueSession, SESSION_COOKIE } from '@/members/session'

import { FORGED_SESSION } from './fixtures/forged-session'

const payload = await getPayload({ config })
const db = payload.db.drizzle
const site = process.env.ERC_CHECK_URL
if (!site) throw new Error('Set ERC_CHECK_URL to the running site')
const siteLog = process.env.ERC_CHECK_LOG
if (!siteLog) throw new Error('Set ERC_CHECK_LOG to the file the running site writes its output to')
const run = Date.now()
const token = `Revchk${run}`
const failures: string[] = []
let passes = 0

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (ok) passes += 1
  else failures.push(label)
}

const decode = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name.replace(/\$/g, '\\$')}="([^"]*)"`).exec(tag)
  return match ? decode(match[1] ?? '') : null
}

type HtmlForm = { action: string; hidden: Record<string, string> }

const formWith = (html: string, marker: string): HtmlForm | null => {
  for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    if (!form.includes(marker)) continue
    const hidden: Record<string, string> = {}
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      const name = attribute(input, 'name')
      if (name && attribute(input, 'type') === 'hidden') hidden[name] = attribute(input, 'value') ?? ''
    }
    return { action: attribute(form.slice(0, form.indexOf('>') + 1), 'action') ?? '', hidden }
  }
  return null
}

/** What a reader sees: no scripts (the RSC payload repeats everything), no comments, and no tags. */
const text = (html: string) =>
  decode(html.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:;])/g, '$1')

type Member = { id: MemberId; email: string; cookie: string; bearer: string }

const newMember = async (name: string): Promise<Member> => {
  const email = `reviews-check-${run}-${name}@example.com`
  const { rows } = await db.execute(sql`INSERT INTO members (email, age_declared_at) VALUES (${email}, now()) RETURNING id`)
  const id = (rows[0] as { id: number }).id as MemberId
  const cookie = (await issueSession(payload, id, 'cookie', 'Web browser')).token
  const bearer = (await issueSession(payload, id, 'bearer', 'Check')).token
  return { id, email, cookie, bearer }
}

const get = (path: string, cookie?: string) => fetch(new URL(path, site), { redirect: 'manual', headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} })
const html = async (path: string, cookie?: string) => (await get(path, cookie)).text()

const submit = async (member: Member, path: string, marker: string, fields: Record<string, string>) => {
  const form = formWith(await html(path, member.cookie), marker)
  if (!form) throw new Error(`No form with ${marker} on ${path}`)
  const body = new FormData()
  for (const [name, value] of Object.entries({ ...form.hidden, ...fields })) body.append(name, value)
  const response = await fetch(new URL(form.action || path, new URL(path, site)), { method: 'POST', body, redirect: 'manual', headers: { cookie: `${SESSION_COOKIE}=${member.cookie}` } })
  return text(await response.text())
}

const api = async (path: string, member: Member | null, body?: unknown) => {
  const headers: Record<string, string> = member ? { authorization: `Bearer ${member.bearer}` } : {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(new URL(`/api/v1${path}`, site), { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: (await response.json().catch(() => null)) as Envelope<Record<string, unknown>> | null }
}
const codeOf = (reply: Awaited<ReturnType<typeof api>>) => [reply.status, reply.body?.ok === false ? reply.body.error.code : 'ok']

/** Payload's own REST, past the API gate with a forged cookie, so only its access rules decide what an anonymous caller reads. */
const rest = async (path: string) => {
  const response = await fetch(new URL(path, site), { headers: FORGED_SESSION })
  return { status: response.status, raw: await response.text() }
}

/** Next expires a write's tags as it replies, so a read a few milliseconds later can still be the old page. */
const settles = async (check: () => Promise<boolean>) => {
  const until = Date.now() + 1500
  for (;;) {
    if (await check()) return true
    if (Date.now() > until) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
const pageShows = (path: string, needle: string) => settles(async () => text(await html(path)).includes(needle))
const pageLacks = (path: string, needle: string) => settles(async () => !text(await html(path)).includes(needle))

const row = async <T>(query: ReturnType<typeof sql>) => ((await db.execute(query)).rows[0] as T | undefined) ?? null
const count = async (query: ReturnType<typeof sql>) => (await row<{ n: number }>(query))?.n ?? 0
const reviewState = (title: string) => row<{ id: number; moderation_state: string }>(sql`SELECT id, moderation_state FROM reviews WHERE title = ${title}`)

const staffDoc = await payload.create({ collection: 'staff', data: { email: `reviews-check-${run}-editor@erc.invalid`, password: `pw-${run}-check`, role: 'editor' } })
const asStaff = { user: { ...staffDoc, collection: 'staff' as const }, overrideAccess: false }
const decide = (collection: 'reviews' | 'questions', id: number, decision: 'approve' | 'reject', reason?: string) =>
  payload.update({ collection, id, ...asStaff, data: { moderationDecision: decision, ...(reason ? { rejectionReason: reason } : {}) } as never })

const shoeSlug = `revchk-${run}`
const raceSlug = `revchk-race-${run}`
const shoePath = `/shoes/${shoeSlug}`
const racePath = `/races/${raceSlug}`
const members: Member[] = []
let shoeId = 0
let raceId = 0
let coachId = 0
let rivalCoachId = 0

try {
  const shoe = await payload.create({
    collection: 'shoes',
    ...asStaff,
    data: { slug: shoeSlug, brand: 'Checkbrand', model: `${token} Trainer`, category: 'road-daily', description: `Check shoe ${run}` },
  })
  shoeId = shoe.id
  const race = await row<{ id: number }>(sql`
    WITH race AS (
      INSERT INTO races (name, slug, discipline, dates_start, dates_day_count, time_zone, location_kind, official_url, registration_url,
        status_kind, source_kind, last_verified_on, summary, moderation_state, moderation_decided_by_id, moderation_decided_at)
      VALUES (${`${token} 10K`}, ${raceSlug}, 'road', '2099-01-01', 1, 'Asia/Kolkata', 'virtual', 'https://example.org', 'https://example.org',
        'scheduled', 'runner-submission', '2026-11-01', 'check', 'approved', ${staffDoc.id}, now())
      RETURNING id
    ), distance AS (
      INSERT INTO races_distances (_order, _parent_id, id, metres, category, band) SELECT 1, id, ${`${raceSlug}-d`}, 10000, '10k', '10k-to-half' FROM race
    )
    SELECT id FROM race`)
  raceId = race!.id
  await refreshRunningSite(payload, [collectionTag('races')])

  const asha = await newMember('asha')
  const ben = await newMember('ben')
  const cara = await newMember('cara')
  const coachMember = await newMember('coach')
  members.push(asha, ben, cara, coachMember)
  const ashaName = `${token} Asha`
  await db.execute(sql`
    INSERT INTO athletes (name, slug, member_id, home_subdivision, visibility_profile, visibility_results, visibility_mileage, moderation_state)
    VALUES (${ashaName}, ${`revchk-asha-${run}`}, ${asha.id}, 'IN-KA', 'public', 'hidden', 'hidden', 'approved')`)
  const coachName = `${token} Coach`
  coachId = (await row<{ id: number }>(sql`
    INSERT INTO coaches (name, slug, member_id, _status) VALUES (${coachName}, ${`revchk-coach-${run}`}, ${coachMember.id}, 'published') RETURNING id`))!.id

  const benTitle = `${token} Ben on the shoe`
  const benReview = { subjectKind: 'shoes', subjectId: shoeId, rating: 4, title: benTitle, body: 'Soft underfoot.\n\nGrips well in the wet.', kmRun: 120 }
  const written = await api('/me/reviews', ben, benReview)
  expect('a member writes a shoe review through the API, and it waits for review', [codeOf(written), (written.body?.ok && (written.body.data.moderation as { state: string }).state) || null], [[200, 'ok'], 'submitted'])
  expect('the API refuses a review from someone not signed in', codeOf(await api('/me/reviews', null, benReview)), [401, 'unauthenticated'])
  expect('a second review of the same shoe by the same member is refused', codeOf(await api('/me/reviews', ben, { ...benReview, title: `${benTitle} again` })), [409, 'conflict'])
  expect('a review of a shoe that does not exist is refused', codeOf(await api('/me/reviews', ben, { ...benReview, subjectId: 999999999 })), [404, 'not_found'])
  expect('a rating outside 1 to 5 is refused with the field named', [codeOf(await api('/me/reviews', cara, { ...benReview, rating: 6 })), (await api('/me/reviews', cara, { ...benReview, rating: 6 })).body], [[422, 'invalid'], { ok: false, error: { code: 'invalid', message: 'Check the highlighted fields.', fields: { rating: 'Choose a rating from 1 to 5.' } } }])

  expect('a pending review is not on the shoe page', await pageLacks(shoePath, benTitle), true)
  const pendingRest = await rest(`/api/reviews?where[title][equals]=${encodeURIComponent(benTitle)}`)
  expect('nor in an anonymous REST read', [pendingRest.status, (JSON.parse(pendingRest.raw) as { totalDocs: number }).totalDocs], [200, 0])
  expect('nor in an anonymous Local API read', (await payload.find({ collection: 'reviews', overrideAccess: false, where: { title: { equals: benTitle } } })).totalDocs, 0)
  expect('the member sees their own review is waiting', text(await html(shoePath, ben.cookie)).includes('Your review is waiting for a club volunteer to check it.'), true)

  const ashaTitle = `${token} Asha on the shoe`
  const ashaPage = await submit(asha, shoePath, 'name="title"', { rating: '5', title: ashaTitle, body: 'My go-to for easy days.', kmRun: '300' })
  expect('a member writes a review with the form, JavaScript off', ashaPage.includes('Thanks. Your review shows here once a club volunteer has checked it.'), true)

  const secret = `private-review-${run}`
  await db.execute(sql.raw(`
    CREATE FUNCTION revchk_fail_${run}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced by check-reviews'; END $$;
    CREATE TRIGGER revchk_fail_${run} BEFORE INSERT ON reviews FOR EACH ROW WHEN (NEW.body LIKE '%private-review-${run}%') EXECUTE FUNCTION revchk_fail_${run}();`))
  const logStart = (await stat(siteLog)).size
  const failedTitle = `${token} Cara on the shoe`
  const failedPage = await submit(cara, shoePath, 'name="title"', { rating: '3', title: failedTitle, body: `Only for the check: ${secret}`, kmRun: '40' })
  const loggedSince = async () => (await readFile(siteLog)).subarray(logStart).toString()
  expect('a write that fails in the database shows the form again with a notice, JavaScript off', [failedPage.includes('Something went wrong. Try again.'), failedPage.includes(`Only for the check: ${secret}`)], [true, true])
  expect('the site logs the failure', await settles(async () => (await loggedSince()).includes('A member action failed')), true)
  expect('and its log does not carry what the member typed', (await loggedSince()).includes(secret), false)
  expect('nothing was stored', await reviewState(failedTitle), null)
  await db.execute(sql.raw(`DROP TRIGGER revchk_fail_${run} ON reviews; DROP FUNCTION revchk_fail_${run}();`))

  const benRow = (await reviewState(benTitle))!
  const ashaRow = (await reviewState(ashaTitle))!
  await decide('reviews', benRow.id, 'approve')
  await decide('reviews', ashaRow.id, 'approve')
  expect('approving makes a review public on the shoe page', await pageShows(shoePath, benTitle), true)
  const shoeText = text(await html(shoePath))
  expect('the average and count cover approved reviews', shoeText.includes('4.5') && shoeText.includes('from 2 reviews'), true)
  expect('a member with no public athlete profile shows as "ERC member"', shoeText.includes(`${benTitle} ERC member 120 km in them`), true)
  expect("a member with a public athlete profile shows by that name, linked to it", (await html(shoePath)).includes(`href="/athletes/revchk-asha-${run}"`), true)
  expect('the list page shows the shoe with its rating', await pageShows('/shoes', `${token} Trainer`), true)
  expect('the category filter keeps it under road, daily and leaves it out of trail', [text(await html('/shoes?category=road-daily')).includes(`${token} Trainer`), text(await html('/shoes?category=trail')).includes(`${token} Trainer`)], [true, false])

  const approvedRest = await rest(`/api/reviews?depth=2&where[title][equals]=${encodeURIComponent(benTitle)}`)
  const approvedDoc = (JSON.parse(approvedRest.raw) as { docs: Record<string, unknown>[] }).docs[0] ?? {}
  expect('anonymous REST reads the approved review without its member or subject key', [approvedRest.status, 'member' in approvedDoc, 'subjectKey' in approvedDoc, approvedDoc.title], [200, false, false, benTitle])
  const publicOutput = [approvedRest.raw, await html(shoePath), await html('/shoes'), await html(racePath)].join('\n')
  expect('no public page or REST reply carries a member email', [ben.email, asha.email].some((email) => publicOutput.includes(email)), false)
  expect('nor a member link', /"member"\s*:/.test(approvedRest.raw), false)

  const edited = await submit(ben, shoePath, 'name="title"', { rating: '2', title: `${benTitle} edited`, body: 'Wore out fast.' })
  expect('a member edits their approved review with the form', edited.includes('Saved. A club volunteer checks every change before it shows again.'), true)
  expect('which sends it back to pending', (await reviewState(`${benTitle} edited`))?.moderation_state, 'submitted')
  expect('and takes it off the public page at once', await pageLacks(shoePath, `${benTitle} edited`), true)
  expect('the old wording is gone too', await pageLacks(shoePath, benTitle), true)
  expect("someone else's review cannot be edited", codeOf(await api('/me/reviews', cara, { ...benReview, review: benRow.id })), [404, 'not_found'])

  await db.execute(sql`
    INSERT INTO reviews (subject_key, member_id, rating, title, body, moderation_state)
    SELECT ${`revchk-filler-${run}-`} || n, ${cara.id}, 3, ${`${token} filler`}, 'filler', 'rejected' FROM generate_series(1, ${REVIEWS_PER_HOUR}) n`)
  expect(`a member who has written ${REVIEWS_PER_HOUR} reviews in an hour is refused the next with 429`, codeOf(await api('/me/reviews', cara, benReview)), [429, 'rate_limited'])
  await db.execute(sql`UPDATE reviews SET created_at = now() - interval '61 minutes' WHERE member_id = ${cara.id}`)
  expect('reviews older than an hour no longer count', codeOf(await api('/me/reviews', cara, benReview)), [200, 'ok'])

  const raceReview = await api('/me/reviews', ben, { subjectKind: 'races', subjectId: raceId, rating: 5, title: `${token} race review`, body: 'Well run.', yearRun: 2025 })
  expect('the same member may review a race as well as a shoe', codeOf(raceReview), [200, 'ok'])
  const mine = await api('/me/reviews', ben)
  expect('myReviews lists both, with the subject named', ((mine.body?.ok ? mine.body.data.items : []) as { subject: { path: string } }[]).map((review) => review.subject.path).sort(), [racePath, shoePath].sort())

  const question = `${token} Is there a bag drop at the start?`
  const asked = await submit(asha, racePath, 'name="text"', { text: question })
  expect('a member asks a question with the form, JavaScript off', asked.includes('Thanks. Your question shows here once a club volunteer has checked it.'), true)
  const questionRow = (await row<{ id: number; moderation_state: string }>(sql`SELECT id, moderation_state FROM questions WHERE text = ${question}`))!
  expect('the question waits for review and is not on the race page', [questionRow.moderation_state, await pageLacks(racePath, question)], ['submitted', true])
  expect('nor in an anonymous REST read', (JSON.parse((await rest(`/api/questions?where[race][equals]=${raceId}`)).raw) as { totalDocs: number }).totalDocs, 0)
  expect('a coach cannot answer a question staff have not approved', codeOf(await api('/coach/questions/answer', coachMember, { question: questionRow.id, answer: 'Yes.' })), [404, 'not_found'])
  await decide('questions', questionRow.id, 'approve')
  expect('approving shows the question, not yet answered', await pageShows(racePath, `${question} Asked by ${ashaName}`), true)
  expect('the race page shows "Not answered yet"', text(await html(racePath)).includes('Not answered yet.'), true)

  expect('a member who is not a linked coach cannot answer', codeOf(await api('/coach/questions/answer', ben, { question: questionRow.id, answer: 'Probably.' })), [403, 'forbidden'])
  expect('nor can someone not signed in', codeOf(await api('/coach/questions/answer', null, { question: questionRow.id, answer: 'Probably.' })), [403, 'forbidden'])
  expect('the coach questions page sends a member who is not a coach back to /me', [(await get('/me/coach/questions', ben.cookie)).status, (await get('/me/coach/questions', ben.cookie)).headers.get('location')], [307, '/me'])
  expect('the coach sees the question on their page with an answer form', formWith(await html('/me/coach/questions', coachMember.cookie), `value="${questionRow.id}"`) !== null, true)

  const answer = `${token} Yes, beside the start pen.`
  const answered = await api('/coach/questions/answer', coachMember, { question: questionRow.id, answer })
  expect('a linked coach answers through the API', [codeOf(answered), answered.body?.ok && answered.body.data.answeredByYou], [[200, 'ok'], true])
  expect('the answer shows on the race page with the coach named', await pageShows(racePath, `Answered by ${coachName}`), true)
  expect('with its text', text(await html(racePath)).includes(answer), true)

  const staffQuestion = `${token} What time does the start close?`
  await submit(cara, racePath, 'name="text"', { text: staffQuestion })
  const staffRow = (await row<{ id: number }>(sql`SELECT id FROM questions WHERE text = ${staffQuestion}`))!
  await decide('questions', staffRow.id, 'approve')
  await payload.update({ collection: 'questions', id: staffRow.id, ...asStaff, data: { answer: 'At 05:45.', answeredBy: { relationTo: 'coaches', value: coachId } } })
  const stamped = await payload.findByID({ collection: 'questions', id: staffRow.id, depth: 0, overrideAccess: true })
  expect('a staff answer in the admin is stamped with the staff member, whatever the request sent', [stamped.answeredBy?.relationTo, stamped.answeredBy?.value, Boolean(stamped.answeredAt)], ['staff', staffDoc.id, true])
  expect('and shows as answered by the club', await pageShows(racePath, 'Answered by the club'), true)
  expect("a coach cannot overwrite someone else's answer", codeOf(await api('/coach/questions/answer', coachMember, { question: staffRow.id, answer: 'No.' })), [409, 'conflict'])

  const dana = await newMember('dana')
  members.push(dana)
  const burst = await Promise.all(
    Array.from({ length: QUESTIONS_PER_HOUR + 5 }, (_, n) => askQuestion(payload, dana.id, { race: raceId as Id<'races'>, text: `${token} burst question ${n}` })),
  )
  expect(`${QUESTIONS_PER_HOUR + 5} questions asked at once let exactly ${QUESTIONS_PER_HOUR} in`, burst.filter((result) => result.ok).length, QUESTIONS_PER_HOUR)

  const rivalMember = await newMember('rival')
  members.push(rivalMember)
  rivalCoachId = (await row<{ id: number }>(sql`
    INSERT INTO coaches (name, slug, member_id, _status) VALUES (${`${token} Rival`}, ${`revchk-rival-${run}`}, ${rivalMember.id}, 'published') RETURNING id`))!.id
  const contested = (await row<{ id: number }>(sql`
    INSERT INTO questions (race_id, member_id, text, moderation_state) VALUES (${raceId}, ${dana.id}, ${`${token} contested`}, 'approved') RETURNING id`))!.id as Id<'questions'>
  const [first, second] = await Promise.all(
    [coachId, rivalCoachId].map((coach) => answerQuestion(payload, coach as CoachId, { question: contested, answer: `${token} from coach ${coach}` })),
  )
  const winner = first?.ok ? coachId : rivalCoachId
  const stored = await payload.findByID({ collection: 'questions', id: contested, depth: 0, overrideAccess: true })
  expect('two coaches answering at once: one gets in, the other is refused', [first?.ok, second?.ok].filter(Boolean).length, 1)
  expect('and the stored answer and its coach are the winner’s', [stored.answer, stored.answeredBy?.relationTo, stored.answeredBy?.value], [`${token} from coach ${winner}`, 'coaches', winner])
  const loser = winner === coachId ? rivalCoachId : coachId
  const refused = await answerQuestion(payload, loser as CoachId, { question: contested, answer: 'Overwrite' })
  expect('the other coach still cannot overwrite it', !refused.ok && refused.error, 'answered_by_someone_else')
  expect('the winner can change their own answer', (await answerQuestion(payload, winner as CoachId, { question: contested, answer: `${token} changed` })).ok, true)

  await db.execute(sql`
    INSERT INTO questions (race_id, member_id, text, moderation_state)
    SELECT ${raceId}, ${ben.id}, ${`${token} filler question`}, 'rejected' FROM generate_series(1, ${QUESTIONS_PER_HOUR})`)
  expect(`a member who has asked ${QUESTIONS_PER_HOUR} questions in an hour is refused the next with 429`, codeOf(await api('/me/questions', ben, { race: raceId, text: 'One more?' })), [429, 'rate_limited'])

  await submit(asha, shoePath, 'Delete my review', {})
  expect('a member deletes their own review with the form', [await reviewState(ashaTitle), await pageLacks(shoePath, ashaTitle)], [null, true])
  expect("deleting someone else's review is refused", codeOf(await api('/me/reviews/delete', cara, { review: (await reviewState(`${benTitle} edited`))!.id })), [404, 'not_found'])

  await payload.delete({ collection: 'members', id: asha.id, overrideAccess: true })
  members.splice(members.indexOf(asha), 1)
  expect("deleting a member deletes their reviews and questions", [await count(sql`SELECT count(*)::int AS n FROM reviews WHERE member_id = ${asha.id}`), await count(sql`SELECT count(*)::int AS n FROM questions WHERE member_id = ${asha.id}`)], [0, 0])
  expect('and their question leaves the race page', await pageLacks(racePath, question), true)

  await payload.delete({ collection: 'shoes', id: shoeId, ...asStaff })
  expect('deleting a shoe deletes its reviews', await count(sql`SELECT count(*)::int AS n FROM reviews WHERE subject_key = ${`shoes:${shoeId}`}`), 0)
  shoeId = 0
} finally {
  await db.execute(sql.raw(`DROP TRIGGER IF EXISTS revchk_fail_${run} ON reviews; DROP FUNCTION IF EXISTS revchk_fail_${run}();`))
  if (shoeId) await payload.delete({ collection: 'shoes', id: shoeId, overrideAccess: true }).catch(() => null)
  if (raceId) await payload.delete({ collection: 'races', id: raceId, overrideAccess: true }).catch(() => null)
  if (coachId) await db.execute(sql`DELETE FROM coaches WHERE id = ${coachId}`)
  if (rivalCoachId) await db.execute(sql`DELETE FROM coaches WHERE id = ${rivalCoachId}`)
  await db.execute(sql`DELETE FROM reviews WHERE subject_key LIKE ${`revchk-filler-${run}-%`}`)
  await db.execute(sql`DELETE FROM athletes WHERE slug = ${`revchk-asha-${run}`}`)
  for (const member of members) await payload.delete({ collection: 'members', id: member.id, overrideAccess: true }).catch(() => null)
  await db.execute(sql`DELETE FROM members WHERE email LIKE ${`reviews-check-${run}-%`}`)
  await payload.delete({ collection: 'staff', id: staffDoc.id })
}

console.log(`${passes} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.error(`Failed: ${failures.join('; ')}`)
  process.exit(1)
}
process.exit(0)
