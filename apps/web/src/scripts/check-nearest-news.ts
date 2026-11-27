/**
 * Proves nearest races, a member's home city, and the news workflow against a migrated database:
 * `pnpm payload run src/scripts/check-nearest-news.ts`. Run `seed-races.ts` first. Set `ERC_CHECK_URL` to a running site
 * (for example `http://localhost:3418`) to add the page, API, cache and revalidation cases; the site and this script
 * need the same `REVALIDATE_SECRET`. Everything it writes is removed.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'

import config from '@payload-config'
import { capitalOf, cityBySlug, cityNamed, todayIn, type City, type MemberId } from '@erc/domain'
import { sql } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'
import { newsBySlug, queryNews } from '@/content/news'
import { queryNearestRaces } from '@/content/races'
import { run, type Caller } from '@/members/run'
import { issueSession, resolveSession, SESSION_COOKIE } from '@/members/session'
import type { Staff } from '@/payload-types'

const payload = await getPayload({ config })
const site = process.env.ERC_CHECK_URL ?? ''
const runId = Date.now()
const today = todayIn('Asia/Kolkata')
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const city = (slug: string): City => {
  const found = cityBySlug(slug)
  if (!found) throw new Error(`${slug} is not in CITIES`)
  return found
}

const page = async (pathname: string, cookie?: string) => {
  const response = await fetch(new URL(pathname, site), { headers: cookie ? { cookie } : {}, redirect: 'manual' })
  return { status: response.status, html: (await response.text()).replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('<!-- -->', '') }
}

const headingOf = (html: string) => /<h1[^>]*>(.*?)<\/h1>/s.exec(html)?.[1]?.replace(/<[^>]+>/g, '').replace(/<!-- -->/g, '') ?? null

const { rows: seeded } = await payload.db.drizzle.execute(sql`
  SELECT count(*)::int AS count FROM races WHERE moderation_state = 'approved' AND location_kind = 'venue' AND dates_start >= ${today}`)
const upcoming = (seeded[0] as { count: number } | undefined)?.count ?? 0
if (upcoming < 50) throw new Error('Too few upcoming races; run src/scripts/seed-races.ts first')

async function nearestCases() {
  for (const slug of ['hyderabad', 'pune', 'leh', 'kolkata']) {
    const origin = city(slug)
    const near = await queryNearestRaces(payload, origin, today, 200)
    const kms = near.map(({ distance }) => (distance.kind === 'unknown' ? Infinity : distance.km))
    expect(`${origin.name}: ranked by distance, nearest first`, kms.every((km, index) => index === 0 || km >= kms[index - 1]!), true)
    const ties = near.slice(1).filter(({ distance }, index) => distance.kind === near[index]!.distance.kind && kms[index + 1] === kms[index])
    expect(
      `${origin.name}: races the same distance away are in date order`,
      near.slice(1).every(({ race, distance }, index) => {
        const previous = near[index]!
        return kms[index + 1] !== kms[index] || previous.distance.kind !== distance.kind || previous.race.dates.start <= race.dates.start
      }) && ties.length > 0,
      true,
    )
    expect(`${origin.name}: only upcoming venue races`, near.every(({ race }) => race.location.kind === 'venue' && race.dates.start >= today), true)
    const { rows } = await payload.db.drizzle.execute(sql`
      SELECT count(*)::int AS count FROM races
      WHERE moderation_state = 'approved' AND location_kind = 'venue' AND dates_start >= ${today} AND lower(location_city) = ${origin.name.toLowerCase()}`)
    const local = (rows[0] as { count: number }).count
    const first = near[0]?.distance
    expect(
      `${origin.name}: a race in the city itself comes first when there is one (${local} seeded)`,
      local > 0 ? first?.kind === 'city' && first.km === 0 : first?.kind !== 'city' || first.km > 0,
      true,
    )
  }
  const fromDelhi = await queryNearestRaces(payload, city('delhi'), today, 400)
  expect(
    'a race in "New Delhi" is placed at Delhi by its alias',
    fromDelhi.some(({ race, distance }) => race.location.kind === 'venue' && race.location.city === 'New Delhi' && distance.kind === 'city' && distance.km === 0),
    true,
  )
  const everything = await queryNearestRaces(payload, city('hyderabad'), today, 10_000)
  const missing = everything.filter(({ race }) => race.location.kind === 'venue' && cityNamed(race.location.city) === null)
  expect(
    `towns missing from the table (${new Set(missing.map(({ race }) => (race.location.kind === 'venue' ? race.location.city : ''))).size} seeded) are placed at their state capital`,
    missing.length > 0 &&
      missing.every(({ race, distance }) => race.location.kind === 'venue' && distance.kind === 'capital' && distance.capital.slug === capitalOf(race.location.subdivision).slug),
    true,
  )
  expect('every upcoming venue race is ranked', everything.length, upcoming)
  expect('an unknown slug is not a city', [cityBySlug('atlantis'), cityBySlug('bangalore')], [null, null])
}

const createdMembers: MemberId[] = []

async function memberCaller(label: string): Promise<{ caller: Caller; token: string; cookieToken: string }> {
  const { rows } = await payload.db.drizzle.execute(sql`
    INSERT INTO members (email, age_declared_at) VALUES (${`nearest-${label}-${runId}@erc.invalid`}, now()) RETURNING id`)
  const member = (rows[0] as { id: number }).id as MemberId
  createdMembers.push(member)
  const token = (await issueSession(payload, member, 'bearer', 'Check')).token
  const cookieToken = (await issueSession(payload, member, 'cookie', 'Check browser')).token
  const session = await resolveSession(payload, token, 'bearer')
  if (!session) throw new Error('Session did not resolve')
  return { caller: { kind: 'member', session, sender: 'check' }, token, cookieToken }
}

const storedCity = async (member: MemberId) => {
  const { rows } = await payload.db.drizzle.execute(sql`SELECT home_city FROM members WHERE id = ${member}`)
  return (rows[0] as { home_city: string | null }).home_city
}

async function homeCityCases() {
  const { caller, token, cookieToken } = await memberCaller('home')
  const member = caller.kind === 'member' ? caller.session.member : (0 as MemberId)
  const dashboardCity = async () => {
    const dashboard = await run('dashboard', caller, {})
    return dashboard.ok ? dashboard.data.member.homeCity : 'failed'
  }
  expect('a new member has no home city', await dashboardCity(), null)
  expect('setHomeCity accepts a city slug', await run('setHomeCity', caller, { city: 'pune' }), { ok: true, data: { homeCity: 'pune' } })
  expect('the city is stored on the member row', await storedCity(member), 'pune')
  expect('the dashboard reports it', await dashboardCity(), 'pune')
  const alias = await run('setHomeCity', caller, { city: 'bangalore' })
  expect('an alias is refused: only slugs are stored', alias.ok ? 'accepted' : alias.error.fields, { city: 'Choose a city from the list.' })
  const junk = await run('setHomeCity', caller, { city: "pune'; DROP TABLE members; --" })
  expect('anything else is refused', junk.ok ? 'accepted' : junk.error.code, 'invalid')
  expect('a refusal leaves the stored city alone', await storedCity(member), 'pune')
  const anonymous = await run('setHomeCity', { kind: 'anonymous', carrier: 'cookie', sender: 'check', rejectedToken: false }, { city: 'leh' })
  expect('an anonymous caller cannot set a city', anonymous.ok ? 'accepted' : anonymous.error.code, 'unauthenticated')

  if (site) {
    const api = await fetch(new URL('/api/v1/me/home-city', site), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ city: 'hyderabad' }),
    })
    expect('POST /api/v1/me/home-city sets it over the API', [api.status, await api.json()], [200, { ok: true, data: { homeCity: 'hyderabad' } }])
    const cookie = `${SESSION_COOKIE}=${cookieToken}`
    const home = await page('/', cookie)
    expect('the home page shows the member "Races near you", from Hyderabad', [home.html.includes('Races near you'), home.html.includes('More races near Hyderabad')], [true, true])
    expect('an anonymous home page has no "Races near you"', (await page('/')).html.includes('Races near you'), false)
    const races = await page('/races', cookie)
    expect('the calendar\'s city select defaults to the member\'s home city', /<option value="hyderabad" selected="">/.test(races.html), true)
    const me = await page('/me', cookie)
    expect('/me shows the home city form with the city chosen', [me.html.includes('Home city'), /<option value="hyderabad" selected="">/.test(me.html)], [true, true])
    const near = await page('/races?near=pune', cookie)
    expect('a member viewing another city is offered their own back', near.html.includes('Back to races near Hyderabad'), true)
  }
  const cleared = await run('setHomeCity', caller, { city: '' })
  expect('an empty choice clears it', [cleared.ok, await storedCity(member)], [true, null])
}

async function nearPageCases() {
  const near = await page('/races?near=pune')
  expect('/races?near=pune is the nearest view', [near.status, headingOf(near.html)], [200, 'Races near Pune'])
  expect('it says how far each race is', /In Pune|~\d+ km away/.test(near.html), true)
  expect('it is noindex and canonical to /races', [near.html.includes('noindex'), near.html.includes('rel="canonical" href="http://') && near.html.includes('/races"')], [true, true])
  const unknown = await page('/races?near=atlantis')
  expect('an unknown city is ignored and the calendar shows', [unknown.status, headingOf(unknown.html)], [200, 'Race calendar'])
  const alias = await page('/races?near=bangalore')
  expect('an alias in the URL is ignored too', headingOf(alias.html), 'Race calendar')

  // `next start` keeps cached reads here, one file per entry, so new files are new cache keys.
  const cacheDir = path.resolve(process.cwd(), '.next/cache/fetch-cache')
  const entries = async () => (await readdir(cacheDir).catch(() => [])).length
  await page('/races')
  await page('/races?near=pune')
  const before = await entries()
  for (let index = 0; index < 5; index++) await page(`/races?near=nowhere-${runId}-${index}`)
  await page('/races?near=pune')
  expect('unknown cities and a repeat city add no cache entries', (await entries()) - before, 0)

  const [nearest] = await queryNearestRaces(payload, city('pune'), today, 1)
  if (!nearest) throw new Error('No race near Pune')
  const renamed = `${nearest.race.name} renamed ${runId}`
  try {
    await payload.update({ collection: 'races', id: nearest.race.id, data: { name: renamed }, context: { skipRevalidation: true } })
    expect('the nearest view is a cached read: a write that skips revalidation is not shown', (await page('/races?near=pune')).html.includes(renamed), false)
    await refreshRunningSite(payload, [collectionTag('races')])
    // The first read after an expiry is sometimes served stale while it refreshes, on the existing race pages too.
    await page('/races?near=pune')
    expect('expiring the races tag brings it through by the next read', (await page('/races?near=pune')).html.includes(renamed), true)
  } finally {
    await payload.update({ collection: 'races', id: nearest.race.id, data: { name: nearest.race.name } })
  }
}

const createdNews: number[] = []
const createdStaff: number[] = []

type StaffUser = Staff & { collection: 'staff' }
const as = (user: StaffUser) => ({ user, overrideAccess: false })

const createStaff = async (role: Staff['role']): Promise<StaffUser> => {
  const doc = await payload.create({
    collection: 'staff',
    data: { email: `nearest-news-${role}-${runId}@erc.invalid`, password: `pw-${runId}-check`, role },
    context: { skipRevalidation: true },
  })
  createdStaff.push(doc.id)
  return { ...doc, collection: 'staff' }
}

async function newsCases() {
  const author = await createStaff('author')
  const editor = await createStaff('editor')
  const [race] = (await queryNearestRaces(payload, city('hyderabad'), today, 1)).map(({ race }) => race)
  const slug = `nearest-news-check-${runId}`
  const headline = `Nearest news check ${runId}`
  const anonymousHeadlines = async () => (await payload.find({ collection: 'news', overrideAccess: false, draft: false, where: { slug: { equals: slug } } })).docs.map((doc) => doc.headline)

  const draft = await payload.create({
    collection: 'news',
    draft: true,
    data: {
      headline,
      slug,
      summary: 'A check item. Staff write these by hand.',
      sourceUrl: 'https://example.org/story',
      sourceName: 'Example Times',
      relatedRace: race?.id ?? null,
      publishedOn: today,
    },
    ...as(author),
  })
  createdNews.push(draft.id)

  const refused = await payload
    .create({ collection: 'news', data: { headline: `${headline} http`, slug: `${slug}-http`, summary: 'x', sourceUrl: 'http://example.org', sourceName: 'x', publishedOn: today, _status: 'published' }, ...as(editor) })
    .then(
      (doc) => (createdNews.push(doc.id), 'allowed'),
      (error: { message?: string }) => error.message ?? 'refused',
    )
  expect('publishing with a source that is not https is refused', refused !== 'allowed', true)
  const long = await payload
    .create({ collection: 'news', data: { headline: `${headline} long`, slug: `${slug}-long`, summary: 'x'.repeat(281), sourceUrl: 'https://example.org', sourceName: 'x', publishedOn: today, _status: 'published' }, ...as(editor) })
    .then(
      (doc) => (createdNews.push(doc.id), 'allowed'),
      () => 'refused',
    )
  expect('publishing a summary over 280 characters is refused', long, 'refused')

  expect('a draft is invisible to the public', await anonymousHeadlines(), [])
  expect('a draft is not in the public list or by slug', [(await queryNews(payload, 1, 100)).items.some((item) => item.slug === slug), await newsBySlug(payload, slug)], [false, null])
  const authorPublish = await payload.update({ collection: 'news', id: draft.id, data: { _status: 'published' }, ...as(author) }).then(
    () => 'allowed',
    (error: { status?: number }) => error.status ?? 'refused',
  )
  expect('an author cannot publish', authorPublish !== 'allowed', true)

  const listBefore = site ? await page('/news') : null
  const itemBefore = site ? await page(`/news/${slug}`) : null
  if (listBefore && itemBefore) {
    expect('the site does not list the draft', listBefore.html.includes(headline), false)
    expect('the draft has no page', itemBefore.status, 404)
  }

  await payload.update({ collection: 'news', id: draft.id, data: { _status: 'published' }, ...as(editor) })
  expect('an editor publishes it and the public can read it', await anonymousHeadlines(), [headline])
  const item = await newsBySlug(payload, slug)
  expect('the published item parses, with its race', [item?.headline, item?.sourceName, item?.race?.slug ?? null], [headline, 'Example Times', race?.slug ?? null])
  expect('it leads the public list', (await queryNews(payload, 1)).items[0]?.slug, slug)

  if (site) {
    const list = await page('/news')
    expect('publishing revalidates /news, which was cached without it', list.html.includes(headline), true)
    const detail = await page(`/news/${slug}`)
    expect('the item has its page with the source link', [detail.status, headingOf(detail.html), detail.html.includes('href="https://example.org/story"')], [200, headline, true])
    expect('the home page shows it among the latest news', (await page('/')).html.includes(headline), true)
    expect('the RSS feed lists it', (await page('/news/rss.xml')).html.includes(`/news/${slug}`), true)
    expect('the sitemap lists it', (await page('/sitemap.xml')).html.includes(`/news/${slug}`), true)
    expect('the nav links to News', /<a[^>]*href="\/news"[^>]*>News<\/a>/.test(list.html), true)

    const unannounced = `${headline} unannounced`
    await payload.update({ collection: 'news', id: draft.id, data: { headline: unannounced, _status: 'published' }, ...as(editor), context: { skipRevalidation: true } })
    expect('/news is a cached read: a publish that skips revalidation is not shown', (await page('/news')).html.includes(unannounced), false)
    await payload.update({ collection: 'news', id: draft.id, data: { headline, _status: 'published' }, ...as(editor) })
  }

  await payload.update({ collection: 'news', id: draft.id, data: { _status: 'draft' }, ...as(editor) })
  expect('unpublishing hides it again', await anonymousHeadlines(), [])
  if (site) {
    expect('and takes it off /news', (await page('/news')).html.includes(headline), false)
    expect('and its page is gone', (await page(`/news/${slug}`)).status, 404)
  }
}

try {
  await nearestCases()
  await homeCityCases()
  if (site) await nearPageCases()
  else console.log('SKIP page, API, cache and revalidation cases: set ERC_CHECK_URL')
  await newsCases()
} finally {
  for (const id of createdNews) await payload.delete({ collection: 'news', id, overrideAccess: true }).catch(() => undefined)
  for (const id of createdMembers) await payload.db.drizzle.execute(sql`DELETE FROM members WHERE id = ${id}`)
  for (const id of createdStaff) await payload.delete({ collection: 'staff', id, overrideAccess: true, context: { skipRevalidation: true } })
}

console.log(failures.length === 0 ? 'All nearest-and-news checks passed' : `${failures.length} failed:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
