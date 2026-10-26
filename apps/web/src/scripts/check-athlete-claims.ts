/**
 * Proves claiming and starting athlete profiles, the field rules, consent, and photos end to end, posting the /me forms
 * the way a browser with JavaScript off does: `ERC_CHECK_URL=<site> pnpm payload run src/scripts/check-athlete-claims.ts`.
 * The site must share this database, `PAYLOAD_SECRET`, `MEDIA_DIR`, and `REVALIDATE_SECRET` (with `ERC_SITE_URL` set
 * here, so staff decisions made in this process expire the site's cache). Members sign in by sessions issued here;
 * check-members.ts proves sign-in itself. Everything it writes is removed.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import type { Envelope, MyAthlete } from '@erc/contract'
import { SEARCHES_PER_HOUR, type MemberId } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'
import sharp from 'sharp'

import { issueSession, SESSION_COOKIE } from '@/members/session'

import { FORGED_SESSION } from './fixtures/forged-session'

const payload = await getPayload({ config })
const site = process.env.ERC_CHECK_URL
if (!site) throw new Error('Set ERC_CHECK_URL to the running site')
const run = Date.now()
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const decode = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name.replace(/\$/g, '\\$')}="([^"]*)"`).exec(tag)
  return match ? decode(match[1] ?? '') : null
}

type HtmlForm = { action: string; hidden: Record<string, string> }

/** The first form whose markup contains `marker`, with its action and every hidden input. */
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

/**
 * What a reader sees: no scripts (the RSC payload repeats everything), no React's text-joining comments, and no tags.
 * A tag becomes a space, so the space it leaves before punctuation is dropped.
 */
const text = (html: string) =>
  decode(html.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:;])/g, '$1')

type Member = { id: MemberId; email: string; cookie: string; bearer: string }

const newMember = async (name: string): Promise<Member> => {
  const email = `claims-check-${run}-${name}@example.com`
  const { rows } = await payload.db.drizzle.execute(sql`INSERT INTO members (email, age_declared_at) VALUES (${email}, now()) RETURNING id`)
  const id = (rows[0] as { id: number }).id as MemberId
  const cookie = (await issueSession(payload, id, 'cookie', 'Web browser')).token
  const bearer = (await issueSession(payload, id, 'bearer', 'Check')).token
  return { id, email, cookie, bearer }
}

const get = (path: string, cookie?: string) =>
  fetch(new URL(path, site), { redirect: 'manual', headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} })
const html = async (path: string, cookie?: string) => (await get(path, cookie)).text()

/** Fills the form marked `marker` on `path` and posts it as the browser would, files included. */
const submit = async (member: Member, path: string, marker: string, fields: Record<string, string | Blob>) => {
  const form = formWith(await html(path, member.cookie), marker)
  if (!form) throw new Error(`No form with ${marker} on ${path}`)
  const body = new FormData()
  for (const [name, value] of Object.entries({ ...form.hidden, ...fields })) body.append(name, value)
  const response = await fetch(new URL(form.action || path, new URL(path, site)), { method: 'POST', body, redirect: 'manual', headers: { cookie: `${SESSION_COOKIE}=${member.cookie}` } })
  return text(await response.text())
}

const api = async (path: string, member: Member, body?: unknown, contentType = 'application/json') => {
  const headers: Record<string, string> = { authorization: `Bearer ${member.bearer}` }
  const multipart = body instanceof FormData
  if (body !== undefined && !multipart) headers['content-type'] = contentType
  const response = await fetch(new URL(`/api/v1${path}`, site), {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  })
  return { status: response.status, body: (await response.json().catch(() => null)) as Envelope<unknown> | null }
}

/**
 * Next expires a write's cache tags as it sends the reply, so a read in the next few milliseconds can still get the
 * old page (about 30 ms here). The cached reads otherwise live an hour, so a change seen within a second was made
 * visible by the write itself.
 */
const settles = async (check: () => Promise<boolean>) => {
  const until = Date.now() + 1000
  for (;;) {
    if (await check()) return true
    if (Date.now() > until) return false
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
const pageShows = (path: string, needle: string) => settles(async () => text(await html(path)).includes(needle))
const pageLacks = (path: string, needle: string) => settles(async () => !text(await html(path)).includes(needle))
const statusIs = (path: string, status: number) => settles(async () => (await get(path)).status === status)

const codeOf = (reply: { status: number; body: Envelope<unknown> | null }) => [reply.status, reply.body?.ok === false ? reply.body.error.code : 'ok']
const athleteOf = async (member: Member) => {
  const reply = await api('/me/athlete', member)
  if (!reply.body?.ok) throw new Error(`myAthlete failed: ${JSON.stringify(reply.body)}`)
  return reply.body.data as MyAthlete
}
const profileOf = async (member: Member) => {
  const mine = await athleteOf(member)
  if (mine.kind !== 'profile') throw new Error(`Expected a profile, got ${mine.kind}`)
  return mine.profile
}

const row = async <T>(query: ReturnType<typeof sql>) => ((await payload.db.drizzle.execute(query)).rows[0] as T | undefined) ?? null
const count = async (query: ReturnType<typeof sql>) => (await row<{ n: number }>(query))?.n ?? 0
const athleteRow = (id: number) =>
  row<{ name: string; member_id: number | null; birth_year: string | null; moderation_state: string; visibility_profile: string; visibility_results: string; visibility_mileage: string; leaderboards: string; photo_id: number | null; home_city: string | null; bio: string | null; slug: string }>(
    sql`SELECT name, member_id, birth_year, moderation_state, visibility_profile, visibility_results, visibility_mileage, leaderboards, photo_id, home_city, bio, slug FROM athletes WHERE id = ${id}`,
  )

const staffDoc = await payload.create({ collection: 'staff', data: { email: `claims-check-${run}-editor@erc.invalid`, password: `pw-${run}-check`, role: 'editor' } })
const asStaff = { user: { ...staffDoc, collection: 'staff' as const }, overrideAccess: false }

/** The status a refused write carries, or `allowed`. */
const outcome = (write: Promise<unknown>) =>
  write.then(
    () => 'allowed',
    (error: { status?: number; message?: string }) => error.status ?? error.message,
  )

const decide = (collection: 'claims' | 'profileChanges' | 'athletes', id: number, decision: 'approve' | 'reject', reason?: string) =>
  payload.update({ collection, id, ...asStaff, data: { moderationDecision: decision, ...(reason ? { rejectionReason: reason } : {}) } as never })

type AthleteData = RequiredDataFromCollectionSlug<'athletes'>
const coachEntered = async (key: string, name: string, visibility: AthleteData['visibility'], approve = true) =>
  payload.create({
    collection: 'athletes',
    ...asStaff,
    data: {
      name,
      slug: `clmchk-${run}-${key}`,
      home: { city: 'Hyderabad', subdivision: 'IN-TS' },
      bio: `Coach-entered bio ${run}`,
      leaderboards: 'included',
      visibility,
      moderation: { state: 'submitted' },
      ...(approve ? { moderationDecision: 'approve' } : {}),
    },
  })

const token = `Clmchk${run}`
const names = { priya: `${token} Priya`, quinn: `${token} Quinn`, ravi: `${token} Ravi`, chloe: `${token} Chloe`, ben: `${token} Ben` }
const ourMembers: Member[] = []
const ourAthletes: number[] = []
const mediaIds = new Set<number>()

/** Whether a stored upload is still on disk; once its document is deleted, Payload's file route answers 500, not 404. */
const onDisk = (filename: string | undefined) => existsSync(path.join(process.env.MEDIA_DIR ?? 'media', filename ?? '?'))

const memberPhotos = async () => {
  const { rows } = await payload.db.drizzle.execute(sql`SELECT id, filename, mime_type FROM media WHERE alt LIKE ${`%${token}%`} ORDER BY id`)
  return rows as { id: number; filename: string; mime_type: string }[]
}

try {
  const priya = await coachEntered('priya', names.priya, { profile: 'public', results: 'public', mileage: 'hidden' })
  const quinn = await coachEntered('quinn', names.quinn, { profile: 'hidden', results: 'hidden', mileage: 'hidden' })
  const ravi = await coachEntered('ravi', names.ravi, { profile: 'public', results: 'public', mileage: 'hidden' }, false)
  ourAthletes.push(priya.id, quinn.id, ravi.id)
  await payload.create({
    collection: 'results',
    ...asStaff,
    data: { athlete: priya.id, eventName: `Claims check 10K ${run}`, date: '2026-03-01', distance: 10_000, finishTime: '0:41:00', provenance: { kind: 'official' }, moderation: { state: 'submitted' }, moderationDecision: 'approve' } as never,
  })

  const asha = await newMember('asha')
  const ben = await newMember('ben')
  const chloe = await newMember('chloe')
  ourMembers.push(asha, ben, chloe)

  const found = await api(`/me/athlete/search?q=${encodeURIComponent(token.toLowerCase())}`, asha)
  const items = found.body?.ok ? (found.body.data as { items: Record<string, unknown>[] }).items : []
  expect('search finds approved coach-entered profiles with no member, hidden ones included, by name', items.map((item) => item.id), [priya.id, quinn.id])
  expect('and returns only id, name and state', items.map((item) => Object.keys(item).sort()), [['id', 'name', 'state'], ['id', 'name', 'state']])
  expect('a two-letter search is refused', codeOf(await api('/me/athlete/search?q=cl', asha)), [422, 'invalid'])
  expect('search needs a member', (await fetch(new URL(`/api/v1/me/athlete/search?q=${token}`, site))).status, 401)
  const fragment = await api('/me/athlete/search?q=riya', asha)
  expect('search matches the start of a word, so a fragment from inside a name does not find it', fragment.body?.ok && (fragment.body.data as { items: { id: number }[] }).items.some((item) => item.id === priya.id), false)

  const searchPage = await html(`/me/athlete?q=${encodeURIComponent(token)}`, asha.cookie)
  expect('/me/athlete lists claimable profiles with a claim form each, and not the unapproved one', [searchPage.includes(`id="claim-${priya.id}"`), searchPage.includes(`id="claim-${quinn.id}"`), text(searchPage).includes(names.ravi)], [true, true, false])

  const claimed = await submit(asha, `/me/athlete?q=${encodeURIComponent(token)}`, `id="claim-${priya.id}"`, { note: `I ran the club 10K in 2025 ${run}` })
  expect('claiming from the form shows the claim waiting for review, without JavaScript', claimed.includes(`Your claim on ${names.priya}, Telangana, is waiting for a coach to review it.`), true)
  const pending = await athleteOf(asha)
  expect('and the API shows the same claim', pending, { kind: 'claim_pending', athlete: { id: priya.id, name: names.priya, state: 'IN-TS' }, note: `I ran the club 10K in 2025 ${run}` })
  expect('/me says the claim is waiting', text(await html('/me', asha.cookie)).includes(`Your claim on ${names.priya} is waiting for a coach to review it.`), true)

  expect('a second open claim by the same member is refused', codeOf(await api('/me/athlete/claim', asha, { athlete: quinn.id, note: 'Also me' })), [409, 'conflict'])
  expect('as is starting a profile while a claim is open', codeOf(await api('/me/athlete/start', asha, { name: 'Asha Again', state: 'IN-TS' })), [409, 'conflict'])
  const benOnPriya = await api('/me/athlete/claim', ben, { athlete: priya.id, note: 'This is me' })
  expect("a second open claim on the same profile is refused, saying someone else asked", [benOnPriya.status, benOnPriya.body?.ok === false && benOnPriya.body.error.message], [409, 'Someone has already asked to claim that profile. If it is yours, contact the club.'])
  expect('one open claim each, held by the database', [await count(sql`SELECT count(*)::int AS n FROM claims WHERE athlete_id = ${priya.id}`), await count(sql`SELECT count(*)::int AS n FROM claims WHERE member_id = ${asha.id}`)], [1, 1])
  expect('a claim on an unapproved profile is refused', codeOf(await api('/me/athlete/claim', ben, { athlete: ravi.id, note: 'Me' })), [404, 'not_found'])

  const login = await fetch(new URL('/api/staff/login', site), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: staffDoc.email, password: `pw-${run}-check` }) })
  const { token: jwt } = (await login.json()) as { token: string }
  const staffHeaders = { authorization: `JWT ${jwt}`, 'content-type': 'application/json' }
  const adminClaims = await (await fetch(new URL('/admin/collections/claims', site), { headers: { cookie: `payload-token=${jwt}` } })).text()
  expect('staff see the claim and its note in /admin', adminClaims.includes(`I ran the club 10K in 2025 ${run}`), true)

  const claimId = (await row<{ id: number }>(sql`SELECT id FROM claims WHERE member_id = ${asha.id}`))!.id
  await decide('claims', claimId, 'approve')
  expect('approving the claim in admin links the member to the profile', (await athleteRow(priya.id))?.member_id, asha.id)
  const linked = await profileOf(asha)
  expect('the API shows the linked profile as public, with the fields and nothing pending', [linked.id, linked.moderation, linked.publicPath, linked.values.name, linked.changes], [priya.id, { state: 'approved' }, `/athletes/${priya.slug}`, names.priya, []])
  expect('/me/athlete shows it', text(await html('/me/athlete', asha.cookie)).includes(`Your profile is public at /athletes/${priya.slug}.`), true)
  const dashboard = await api('/me/dashboard', asha)
  expect('the dashboard carries the athlete section', dashboard.body?.ok && (dashboard.body.data as { athlete: MyAthlete }).athlete.kind, 'profile')
  expect('/me summarises it', text(await html('/me', asha.cookie)).includes(`Your profile, ${names.priya}, is public.`), true)
  const afterLink = await api(`/me/athlete/search?q=${encodeURIComponent(token)}`, ben)
  expect('a linked profile leaves the search', afterLink.body?.ok && (afterLink.body.data as { items: { id: number }[] }).items.map((item) => item.id), [quinn.id])
  expect('and cannot be claimed', codeOf(await api('/me/athlete/claim', ben, { athlete: priya.id, note: 'Me' })), [404, 'not_found'])

  const hijack = await api('/me/athlete/profile', ben, { athlete: priya.id, name: 'Hijacked', city: 'Nowhere' })
  const hijackShow = await api('/me/athlete/visibility', ben, { athlete: priya.id, profile: 'hidden' })
  expect("another member cannot change someone else's profile or its visibility: they have none of their own", [codeOf(hijack), codeOf(hijackShow)], [
    [404, 'not_found'],
    [404, 'not_found'],
  ])
  expect('nor read it', (await athleteOf(ben)).kind, 'none')
  const untouched = await athleteRow(priya.id)
  expect('and the profile is untouched', [untouched?.name, untouched?.home_city, untouched?.visibility_profile], [names.priya, 'Hyderabad', 'public'])

  await payload.update({ collection: 'athletes', id: priya.id, ...asStaff, data: { visibility: { profile: 'hidden', results: 'hidden', mileage: 'public' } } })
  const staffRest = await fetch(new URL(`/api/athletes/${priya.id}`, site), { method: 'PATCH', headers: staffHeaders, body: JSON.stringify({ visibility: { profile: 'hidden' } }) })
  const afterStaff = await athleteRow(priya.id)
  expect("staff cannot change a linked profile's visibility, in the Local API or over REST", [staffRest.status, afterStaff?.visibility_profile, afterStaff?.visibility_results, afterStaff?.visibility_mileage], [200, 'public', 'public', 'hidden'])
  await payload.update({ collection: 'athletes', id: priya.id, ...asStaff, data: { leaderboards: 'withheld' } })
  expect('but can withhold it from leaderboards', (await athleteRow(priya.id))?.leaderboards, 'withheld')
  const staffQuinn = await payload.update({ collection: 'athletes', id: quinn.id, ...asStaff, data: { visibility: { profile: 'hidden', results: 'hidden', mileage: 'public' } } })
  expect('and still set visibility on a profile no member holds', staffQuinn.visibility.mileage, 'public')

  expect('the public directory lists the linked profile', text(await html('/athletes')).includes(names.priya), true)
  expect('with its results', text(await html(`/athletes/${priya.slug}`)).includes(`Claims check 10K ${run}`), true)
  const hid = await submit(asha, '/me/athlete', 'id="show"', { profile: 'hidden', results: 'public', mileage: 'hidden' })
  expect('hiding the profile from the form saves', hid.includes('Saved. The public pages now show exactly this.'), true)
  expect('and takes it off /athletes at once', [await pageLacks('/athletes', names.priya), await statusIs(`/athletes/${priya.slug}`, 404)], [true, true])
  await api('/me/athlete/visibility', asha, { profile: 'public', mileage: 'public' })
  expect('showing it again over the API puts it back at once', [await pageShows('/athletes', names.priya), await statusIs(`/athletes/${priya.slug}`, 200)], [true, true])
  expect('and stores the mileage choice', (await athleteRow(priya.id))?.visibility_mileage, 'public')
  await api('/me/athlete/visibility', asha, { results: 'hidden' })
  expect('hiding results takes them off the profile at once', await pageLacks(`/athletes/${priya.slug}`, `Claims check 10K ${run}`), true)
  await api('/me/athlete/visibility', asha, { results: 'public' })

  const city = await api('/me/athlete/profile', asha, { city: `Warangal ${run}` })
  expect('a direct field changes at once', [city.status, await pageShows(`/athletes/${priya.slug}`, `Warangal ${run}`)], [200, true])

  const renamed = `${names.priya} Reddy`
  const edited = await submit(asha, '/me/athlete', 'id="profile"', { name: renamed, city: `Hanamkonda ${run}`, state: 'IN-TS', runningSince: '2015', birthYear: '1931', bio: `Coach-entered bio ${run}` })
  expect('a reviewed field edited on the form waits for review', [edited.includes('Saved.'), edited.includes(`Name is waiting for a coach to review it: ${renamed}`)], [true, true])
  const held = await athleteRow(priya.id)
  expect('while the live profile keeps the old name, and the private birth year is stored at once', [held?.name, Number(held?.birth_year)], [names.priya, 1931])
  const refreshed = await pageShows(`/athletes/${priya.slug}`, `Hanamkonda ${run}`)
  const kept = text(await html(`/athletes/${priya.slug}`))
  expect('the public page, refreshed by the city in the same edit, still shows the old name', [refreshed, kept.includes(names.priya), kept.includes(renamed)], [true, true, false])
  const waiting = (await profileOf(asha)).changes
  expect('the API lists the change as waiting', waiting.map((change) => [change.field, change.state, change.value]), [['name', 'submitted', renamed]])
  const nameChange = (await row<{ id: number }>(sql`SELECT id FROM profile_changes WHERE athlete_id = ${priya.id} AND field = 'name'`))!.id
  await decide('profileChanges', nameChange, 'approve')
  expect('approving the change in admin applies it to the public profile', [await pageShows(`/athletes/${priya.slug}`, renamed), (await profileOf(asha)).changes], [true, []])

  await api('/me/athlete/profile', asha, { bio: `A new bio for review ${run}` })
  const bioChange = (await row<{ id: number }>(sql`SELECT id FROM profile_changes WHERE athlete_id = ${priya.id} AND field = 'bio' AND moderation_state = 'submitted'`))!.id
  await decide('profileChanges', bioChange, 'reject', 'Please keep it about running.')
  const refused = (await profileOf(asha)).changes
  expect('a rejected change shows its reason to the member', refused.map((change) => [change.field, change.state, change.state === 'rejected' ? change.reason : null]), [['bio', 'rejected', 'Please keep it about running.']])
  expect('on /me/athlete too', text(await html('/me/athlete', asha.cookie)).includes('About you was not approved: Please keep it about running.'), true)
  expect('and the public profile never showed it', text(await html(`/athletes/${priya.slug}`)).includes(`A new bio for review ${run}`), false)
  await api('/me/athlete/profile', asha, { name: `${renamed} Again` })
  await api('/me/athlete/profile', asha, { name: renamed })
  expect('setting a field back to its live value withdraws the waiting change', await count(sql`SELECT count(*)::int AS n FROM profile_changes WHERE athlete_id = ${priya.id} AND moderation_state = 'submitted'`), 0)
  await api('/me/athlete/profile', asha, { bio: '' })
  expect('emptying a reviewed field applies at once, since hiding never waits', (await athleteRow(priya.id))?.bio, '')

  const publicPages = [await html('/athletes'), await html(`/athletes/${priya.slug}`), await html(`/athletes?state=telangana`)]
  expect('the birth year and the member email are in no public page', publicPages.map((page) => [page.includes('1931'), page.includes(asha.email)]), publicPages.map(() => [false, false]))
  const restAnon = await fetch(new URL(`/api/athletes/${priya.id}?depth=2`, site), { headers: FORGED_SESSION })
  const restAnonBody = await restAnon.text()
  const restKeys = Object.keys(JSON.parse(restAnonBody) as object)
  expect('the public REST reply has no member, birth year or leaderboard switch', [restAnon.status, restKeys.includes('member'), restKeys.includes('birthYear'), restKeys.includes('leaderboards'), restAnonBody.includes('1931'), restAnonBody.includes(asha.email)], [200, false, false, false, false, false])
  const restStaff = (await (await fetch(new URL(`/api/athletes/${priya.id}`, site), { headers: staffHeaders })).json()) as Record<string, unknown>
  expect('staff do not read the birth year either, but do see the member link', ['birthYear' in restStaff, restStaff.member !== undefined && restStaff.member !== null], [false, true])
  const oracle = async (where: string) => {
    const response = await fetch(new URL(`/api/athletes?${where}`, site), { headers: FORGED_SESSION })
    const body = (await response.json().catch(() => ({}))) as { docs?: { id: number }[] }
    return (body.docs ?? []).some((doc) => doc.id === priya.id)
  }
  expect('nor can a public query test the birth year or the member', [await oracle('where[birthYear][equals]=1931'), await oracle(`where[member][equals]=${asha.id}`), await oracle('where[member][exists]=true')], [false, false, false])
  const requests = await Promise.all(['claims', 'profileChanges'].map(async (collection) => (await fetch(new URL(`/api/${collection}`, site), { headers: FORGED_SESSION })).status))
  expect('claims and profile changes are not readable without staff', requests, [403, 403])

  const started = await submit(chloe, '/me/athlete', 'id="new"', { name: names.chloe, state: 'IN-KA', city: 'Mysuru', runningSince: '2019', birthYear: '1990', bio: '' })
  expect('starting a profile from the form sends it for review', started.includes('Your profile is waiting for a coach to review it.'), true)
  const chloeProfile = await profileOf(chloe)
  ourAthletes.push(chloeProfile.id)
  const chloeRow = await athleteRow(chloeProfile.id)
  expect('as a submitted row owned by the member, hidden in every part, with a slug from the name', [chloeRow?.member_id, chloeRow?.moderation_state, chloeRow?.visibility_profile, chloeRow?.visibility_results, chloeRow?.visibility_mileage, chloeRow?.slug], [chloe.id, 'submitted', 'hidden', 'hidden', 'hidden', `clmchk${run}-chloe`])
  await api('/me/athlete/profile', chloe, { name: `${names.chloe} K` })
  expect('before approval a reviewed field changes the submitted row directly', [(await athleteRow(chloeProfile.id))?.name, await count(sql`SELECT count(*)::int AS n FROM profile_changes WHERE athlete_id = ${chloeProfile.id}`)], [`${names.chloe} K`, 0])
  expect('a member with a profile cannot start or claim another', [codeOf(await api('/me/athlete/start', chloe, { name: 'Again', state: 'IN-KA' })), codeOf(await api('/me/athlete/claim', chloe, { athlete: quinn.id, note: 'me' }))], [
    [409, 'conflict'],
    [409, 'conflict'],
  ])
  expect('an unapproved started profile is not in the search', (await api(`/me/athlete/search?q=${encodeURIComponent(names.chloe)}`, ben)).body, { ok: true, data: { items: [] } })
  const adminAthletes = await (await fetch(new URL('/admin/collections/athletes', site), { headers: { cookie: `payload-token=${jwt}` } })).text()
  expect('the started profile waits in the admin athletes list', adminAthletes.includes(`${names.chloe} K`), true)
  await decide('athletes', chloeProfile.id, 'approve')
  expect('once approved it is still hidden until the member shows it', [(await profileOf(chloe)).moderation.state, (await profileOf(chloe)).publicPath], ['approved', null])
  await api('/me/athlete/visibility', chloe, { profile: 'public' })
  expect('and then it is public', await pageShows('/athletes', `${names.chloe} K`), true)

  const withExif = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c03030' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: `exif-marker-${run}`, ImageDescription: 'home GPS' } })
    .toBuffer()
  expect('the test photo carries EXIF to strip', withExif.includes(Buffer.from(`exif-marker-${run}`)), true)
  const uploaded = await submit(chloe, '/me/athlete', 'id="photo-upload"', { photo: new Blob([new Uint8Array(withExif)], { type: 'image/jpeg' }) })
  expect('uploading a photo on the form waits for review on an approved profile', uploaded.includes('Photo is waiting for a coach to review it.'), true)
  const [firstPhoto] = await memberPhotos()
  if (firstPhoto) mediaIds.add(firstPhoto.id)
  const photoFile = Buffer.from(await (await get(`/api/media/file/${firstPhoto?.filename}`)).arrayBuffer())
  expect('stored as a member WebP with no EXIF left in it', [firstPhoto?.filename.startsWith('member-photo-'), firstPhoto?.mime_type, photoFile.subarray(8, 12).toString(), photoFile.includes(Buffer.from(`exif-marker-${run}`)), photoFile.includes(Buffer.from('Exif')), onDisk(firstPhoto?.filename)], [true, 'image/webp', 'WEBP', false, false, true])
  expect('and not on the public profile yet', [(await athleteRow(chloeProfile.id))?.photo_id, (await html(`/athletes/${chloeRow?.slug}`)).includes(firstPhoto?.filename ?? '?')], [null, false])
  const photoChange = (await row<{ id: number }>(sql`SELECT id FROM profile_changes WHERE athlete_id = ${chloeProfile.id} AND field = 'photo'`))!.id
  await decide('profileChanges', photoChange, 'approve')
  const photoShown = await settles(async () => (await html(`/athletes/${chloeRow?.slug}`)).includes(firstPhoto?.filename ?? '?'))
  expect('approved, it shows on the public profile', [(await athleteRow(chloeProfile.id))?.photo_id, photoShown], [firstPhoto?.id, true])

  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#30c030' } }).png().toBuffer()
  const multipart = new FormData()
  multipart.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'me.png')
  const apiPhoto = await api('/me/athlete/photo', chloe, multipart)
  const secondPhoto = (await memberPhotos()).at(-1)
  if (secondPhoto) mediaIds.add(secondPhoto.id)
  expect('the API takes a photo as multipart, and it waits for review', [apiPhoto.status, (await profileOf(chloe)).changes.map((change) => [change.field, change.state])], [200, [['photo', 'submitted']]])
  const secondChange = (await row<{ id: number }>(sql`SELECT id FROM profile_changes WHERE athlete_id = ${chloeProfile.id} AND field = 'photo' AND moderation_state = 'submitted'`))!.id
  await decide('profileChanges', secondChange, 'reject', 'Please use a photo of yourself.')
  const rejectedFile = await get(`/api/media/file/${secondPhoto?.filename}`)
  expect('a rejected photo is deleted, so its address stops working', [await payload.findByID({ collection: 'media', id: secondPhoto!.id, disableErrors: true, overrideAccess: true }), rejectedFile.ok, onDisk(secondPhoto?.filename)], [null, false, false])
  expect('and the member sees why', (await profileOf(chloe)).changes.map((change) => [change.field, change.state === 'rejected' ? change.reason : change.state]), [['photo', 'Please use a photo of yourself.']])
  expect('a photo sent as JSON is refused as the wrong media type', codeOf(await api('/me/athlete/photo', chloe, { photo: 'x' })), [415, 'unsupported_media_type'])
  const fake = new FormData()
  fake.append('photo', new Blob(['not an image at all'], { type: 'image/png' }), 'fake.png')
  const svg = new FormData()
  svg.append('photo', new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'x.svg')
  expect('a file that is not really an image, or an SVG, is refused', [codeOf(await api('/me/athlete/photo', chloe, fake)), codeOf(await api('/me/athlete/photo', chloe, svg))], [
    [415, 'unsupported_media_type'],
    [422, 'invalid'],
  ])
  const huge = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#3030c0' } }).jpeg({ quality: 10 }).toBuffer()
  const photosBefore = (await memberPhotos()).length
  const hugeForm = new FormData()
  hugeForm.append('photo', new Blob([new Uint8Array(huge)], { type: 'image/jpeg' }), 'huge.jpg')
  expect('a photo of more than 30 million pixels is refused before it is decoded, and nothing is stored', [huge.length < 5 * 1024 * 1024, codeOf(await api('/me/athlete/photo', chloe, hugeForm)), (await memberPhotos()).length], [true, [415, 'unsupported_media_type'], photosBefore])
  const oversized = new FormData()
  oversized.append('photo', new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/jpeg' }), 'big.jpg')
  expect('a body larger than the operation can use is refused from its declared length', [codeOf(await api('/me/athlete/photo', chloe, oversized)), codeOf(await api('/me/athlete/profile', chloe, { city: 'x'.repeat(70 * 1024) }))], [
    [413, 'too_large'],
    [413, 'too_large'],
  ])
  const removed = await submit(chloe, '/me/athlete', 'id="photo-remove"', {})
  expect('removing the photo takes it off at once and deletes the member upload', [removed.includes('Your current photo'), (await athleteRow(chloeProfile.id))?.photo_id, (await get(`/api/media/file/${firstPhoto?.filename}`)).ok, onDisk(firstPhoto?.filename)], [false, null, false, false])

  const benStart = await api('/me/athlete/start', ben, { name: names.ben, state: 'IN-AP' })
  const benProfile = await profileOf(ben)
  ourAthletes.push(benProfile.id)
  await api('/me/athlete/photo', ben, (() => {
    const form = new FormData()
    form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ben.png')
    return form
  })())
  const benPhoto = (await memberPhotos()).at(-1)
  if (benPhoto) mediaIds.add(benPhoto.id)
  expect('before approval a photo applies to the submitted profile directly', [benStart.status, (await athleteRow(benProfile.id))?.photo_id, await count(sql`SELECT count(*)::int AS n FROM profile_changes WHERE athlete_id = ${benProfile.id}`), onDisk(benPhoto?.filename)], [200, benPhoto?.id, 0, true])
  await api('/me/athlete/profile', ben, { athlete: priya.id, name: 'Hijacked' })
  expect("a member's edits reach only their own profile, whatever id they send", [(await athleteRow(benProfile.id))?.name, (await athleteRow(priya.id))?.name], ['Hijacked', renamed])

  const xena = await newMember('xena')
  const yuri = await newMember('yuri')
  ourMembers.push(xena, yuri)
  await api('/me/athlete/claim', xena, { athlete: quinn.id, note: 'Quinn is me' })
  await payload.db.drizzle.execute(sql`UPDATE athletes SET member_id = ${yuri.id} WHERE id = ${quinn.id}`)
  const xenaClaim = (await row<{ id: number }>(sql`SELECT id FROM claims WHERE member_id = ${xena.id}`))!.id
  const lateApproval = await outcome(decide('claims', xenaClaim, 'approve'))
  const afterLate = await row<{ moderation_state: string }>(sql`SELECT moderation_state FROM claims WHERE id = ${xenaClaim}`)
  expect('approving a claim on a profile linked meanwhile is refused and rolled back', [lateApproval, afterLate?.moderation_state, (await athleteRow(quinn.id))?.member_id], [409, 'submitted', yuri.id])

  await decide('claims', xenaClaim, 'reject', 'We could not match you to this profile.')
  expect('a rejected claim leaves the member with no profile and the reason, over the API and on /me', [await athleteOf(xena), text(await html('/me', xena.cookie)).includes(`Your claim on ${names.quinn} was not approved: We could not match you to this profile.`)], [
    { kind: 'none', rejectedClaim: { athleteName: names.quinn, reason: 'We could not match you to this profile.' } },
    true,
  ])

  const dev = await newMember('dev')
  ourMembers.push(dev)
  await api('/me/athlete/start', dev, { name: `${token} Dev`, state: 'IN-GA' })
  const devFirst = await profileOf(dev)
  ourAthletes.push(devFirst.id)
  await decide('athletes', devFirst.id, 'reject', 'Please use your full name.')
  expect('a rejected started profile shows its reason', [(await profileOf(dev)).moderation, text(await html('/me/athlete', dev.cookie)).includes('The profile you started was not approved: Please use your full name.')], [
    { state: 'rejected', reason: 'Please use your full name.' },
    true,
  ])
  expect('and takes no edits', codeOf(await api('/me/athlete/profile', dev, { city: 'Panaji' })), [409, 'conflict'])
  await api('/me/athlete/start', dev, { name: `${token} Dev Kumar`, state: 'IN-GA' })
  const devSecond = await profileOf(dev)
  ourAthletes.push(devSecond.id)
  expect('starting again replaces the rejected profile', [await athleteRow(devFirst.id), devSecond.moderation.state, devSecond.values.name], [null, 'submitted', `${token} Dev Kumar`])
  const devPhotoForm = new FormData()
  devPhotoForm.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'dev.png')
  await api('/me/athlete/photo', dev, devPhotoForm)
  const devPhoto = (await memberPhotos()).at(-1)
  expect('a photo on a profile not yet approved applies at once', (await athleteRow(devSecond.id))?.photo_id, devPhoto?.id)
  await payload.delete({ collection: 'athletes', id: devSecond.id, overrideAccess: true })
  expect('deleting an athlete deletes the member photo on it, so its address stops working', [onDisk(devPhoto?.filename), await payload.findByID({ collection: 'media', id: devPhoto!.id, disableErrors: true, overrideAccess: true })], [false, null])
  let refusedAt = 0
  for (let n = 1; n <= SEARCHES_PER_HOUR + 1 && refusedAt === 0; n += 1) {
    if ((await api(`/me/athlete/search?q=${encodeURIComponent(token)}`, dev)).status === 429) refusedAt = n
  }
  expect('one member gets a limited number of searches an hour', refusedAt, SEARCHES_PER_HOUR + 1)

  const chloeDoc = await payload.findByID({ collection: 'athletes', id: chloeProfile.id, depth: 0, overrideAccess: true })
  await payload.delete({ collection: 'members', id: chloe.id, overrideAccess: true })
  const released = await athleteRow(chloeDoc.id)
  expect("deleting a member unlinks and hides their public profile and drops their changes", [released?.member_id, released?.visibility_profile, await count(sql`SELECT count(*)::int AS n FROM profile_changes WHERE athlete_id = ${chloeDoc.id}`)], [null, 'hidden', 0])
  await payload.delete({ collection: 'members', id: ben.id, overrideAccess: true })
  expect("and deletes a profile they started that was never approved, with the photo they uploaded", [await athleteRow(benProfile.id), onDisk(benPhoto?.filename)], [null, false])
  ourMembers.splice(ourMembers.indexOf(chloe), 1)
  ourMembers.splice(ourMembers.indexOf(ben), 1)
} finally {
  const memberIds = ourMembers.map((member) => member.id)
  if (memberIds.length > 0) {
    const inList = sql.join(memberIds.map((id) => sql`${id}`), sql`, `)
    await payload.db.drizzle.execute(sql`DELETE FROM profile_changes WHERE member_id IN (${inList})`)
    await payload.db.drizzle.execute(sql`DELETE FROM claims WHERE member_id IN (${inList})`)
    const { rows } = await payload.db.drizzle.execute(sql`SELECT id FROM athletes WHERE member_id IN (${inList})`)
    ourAthletes.push(...(rows as { id: number }[]).map((r) => r.id))
  }
  for (const id of new Set(ourAthletes)) await payload.delete({ collection: 'athletes', id, overrideAccess: true }).catch(() => null)
  for (const photo of await memberPhotos()) mediaIds.add(photo.id)
  for (const id of mediaIds) await payload.delete({ collection: 'media', id, overrideAccess: true }).catch(() => null)
  await payload.db.drizzle.execute(sql`DELETE FROM members WHERE email LIKE ${`claims-check-${run}-%`}`)
  await payload.delete({ collection: 'staff', id: staffDoc.id })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('All athlete claim checks passed')
process.exit(0)
