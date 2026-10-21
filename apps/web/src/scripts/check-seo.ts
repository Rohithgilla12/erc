/**
 * Proves the sitemap, robots.txt, the article feed, and the JSON-LD of every public page type against a running site:
 * `ERC_CHECK_URL=http://localhost:3000 pnpm payload run src/scripts/check-seo.ts`. Run every seed script first. It
 * publishes a post whose title needs escaping, and adds a draft post, a `noindex` post and a draft video that must not
 * appear; everything it writes is removed.
 */
import config from '@payload-config'
import { todayIn } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug, type Where } from 'payload'

import type { Staff } from '@/payload-types'

const site = process.env.ERC_CHECK_URL ?? ''
if (!site) throw new Error('Set ERC_CHECK_URL to a running site, such as http://localhost:3000')

const payload = await getPayload({ config })
const run = Date.now()
const today = todayIn('Asia/Kolkata')
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

type StaffUser = Staff & { collection: 'staff' }
const createStaff = async (role: Staff['role']): Promise<StaffUser> => {
  const doc = await payload.create({
    collection: 'staff',
    data: { email: `seo-check-${role}-${run}@erc.invalid`, password: `pw-${run}-check`, role },
    context: { skipRevalidation: true },
  })
  return { ...doc, collection: 'staff' }
}
const as = (user: StaffUser) => ({ user, overrideAccess: false })

const author = await createStaff('author')
const editor = await createStaff('editor')
const created = { posts: [] as number[], videos: [] as number[] }

const topic = (await payload.find({ collection: 'topics', where: { slug: { equals: 'beginner-running' } }, limit: 1 })).docs[0]
const coach = (await payload.find({ collection: 'coaches', where: { slug: { equals: 'placeholder-coach-a' } }, limit: 1 })).docs[0]
if (!topic || !coach) throw new Error('Run src/scripts/seed-learn.ts first')

const paragraph = (value: string) => ({
  root: {
    type: 'root',
    version: 1,
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    children: [{ type: 'paragraph', version: 1, direction: 'ltr', format: '', indent: 0, children: [{ type: 'text', version: 1, text: value }] }],
  },
})

const post = (slug: string, title: string, excerpt: string): RequiredDataFromCollectionSlug<'posts'> => ({
  title,
  slug,
  excerpt,
  topics: [topic.id],
  authors: [coach.id],
  body: paragraph(`SEO check body ${run}`),
})

const ESCAPED_TITLE = `SEO check & <escape> "quotes" 'apostrophe' ${run}`
const ESCAPED_EXCERPT = `Fish & chips <b>bold</b> ${run}`
const slugs = { live: `seo-check-live-${run}`, draft: `seo-check-draft-${run}`, hidden: `seo-check-noindex-${run}`, video: `seo-check-video-${run}` }

async function createFixtures() {
  const live = await payload.create({ collection: 'posts', data: { ...post(slugs.live, ESCAPED_TITLE, ESCAPED_EXCERPT), _status: 'published' }, ...as(editor) })
  const draft = await payload.create({ collection: 'posts', data: post(slugs.draft, `SEO check draft ${run}`, 'Draft excerpt'), draft: true, ...as(author) })
  const hidden = await payload.create({
    collection: 'posts',
    data: { ...post(slugs.hidden, `SEO check noindex ${run}`, 'Hidden excerpt'), seo: { noindex: true }, _status: 'published' },
    ...as(editor),
  })
  created.posts.push(live.id, draft.id, hidden.id)
  const video = await payload.create({
    collection: 'videos',
    data: {
      title: `SEO check video ${run}`,
      slug: slugs.video,
      youtubeId: 'placehold-q',
      duration: '1:05',
      category: 'technique',
      description: paragraph('Draft video'),
    },
    draft: true,
    ...as(author),
  })
  created.videos.push(video.id)
}

const fetchText = async (path: string) => {
  const response = await fetch(new URL(path, site))
  return { status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() }
}

const pathsOf = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]!.replace(new URL(site).origin, ''))

async function sitemapCases() {
  const sitemap = await fetchText('/sitemap.xml')
  const paths = pathsOf(sitemap.body)
  const listed = new Set(paths)
  expect('the sitemap is served as XML', [sitemap.status, sitemap.type.startsWith('application/xml')], [200, true])
  expect('every sitemap URL is absolute on the site', [...sitemap.body.matchAll(/<loc>(.*?)<\/loc>/g)].every((m) => m[1]!.startsWith(new URL(site).origin)), true)
  expect('every sitemap URL has a lastmod', (sitemap.body.match(/<lastmod>/g) ?? []).length, paths.length)
  expect('no filtered or paginated view is listed', paths.filter((path) => path.includes('?')), [])
  expect(
    'the static sections and site pages are listed',
    ['/', '/races', '/learn', '/videos', '/plans', '/athletes', '/coaching', '/about', '/contact', '/resources', '/privacy'].filter((path) => !listed.has(path)),
    [],
  )
  expect('the published post is listed', listed.has(`/learn/${slugs.live}`), true)
  expect('a draft post is not listed', listed.has(`/learn/${slugs.draft}`), false)
  expect('a noindex post is not listed', listed.has(`/learn/${slugs.hidden}`), false)
  expect('a draft video is not listed', listed.has(`/videos/${slugs.video}`), false)

  const athletes = await payload.find({ collection: 'athletes', depth: 0, pagination: false, select: { slug: true, moderation: true, visibility: true } })
  const privateAthletes = athletes.docs.filter((a) => a.moderation.state !== 'approved' || a.visibility.profile !== 'public').map((a) => a.slug)
  const publicAthletes = athletes.docs.map((a) => a.slug).filter((slug) => !privateAthletes.includes(slug))
  expect('there is a hidden or unapproved athlete to test against', privateAthletes.length > 0, true)
  expect('no hidden or unapproved athlete is listed', privateAthletes.filter((slug) => listed.has(`/athletes/${slug}`)), [])
  expect('every public athlete is listed', publicAthletes.filter((slug) => !listed.has(`/athletes/${slug}`)), [])

  const races = await payload.find({ collection: 'races', depth: 0, pagination: false, select: { slug: true, moderation: true, dates: true } })
  const unapproved = races.docs.filter((race) => race.moderation.state !== 'approved').map((race) => race.slug)
  const past = races.docs.filter((race) => race.moderation.state === 'approved' && race.dates.start < today).map((race) => race.slug)
  const upcoming = races.docs.filter((race) => race.moderation.state === 'approved' && race.dates.start >= today).map((race) => race.slug)
  expect('there are unapproved races to test against', unapproved.length > 0, true)
  expect('no submitted or rejected race is listed', unapproved.filter((slug) => listed.has(`/races/${slug}`)), [])
  expect('no past race is listed', past.filter((slug) => listed.has(`/races/${slug}`)), [])
  expect('every approved upcoming race is listed', upcoming.filter((slug) => !listed.has(`/races/${slug}`)), [])
  expect('the Telangana and trail landing pages are listed', [listed.has('/races/in/telangana'), listed.has('/races/discipline/trail')], [true, true])
}

async function robotsCases() {
  const robots = await fetchText('/robots.txt')
  const lines = robots.body.split('\n')
  expect(
    'robots.txt allows the site, keeps crawlers out of the admin, API, files and player views, and names the sitemap',
    ['Allow: /', 'Disallow: /admin', 'Disallow: /api', 'Disallow: /downloads/', 'Disallow: /videos/*?play=', `Sitemap: ${new URL('/sitemap.xml', site).href}`].filter(
      (line) => !lines.includes(line),
    ),
    [],
  )
}

const RFC_822 = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/

async function feedCases() {
  const feed = await fetchText('/learn/rss.xml')
  expect('the feed is served as RSS', [feed.status, feed.type], [200, 'application/rss+xml; charset=utf-8'])
  expect('the feed is RSS 2.0', feed.body.includes('<rss version="2.0"'), true)
  const items = [...feed.body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]!)
  const field = (item: string, name: string) => item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? null
  expect(
    'every item has a title, link, permalink guid, RFC 822 date and description',
    items.every((item) => ['title', 'link', 'description'].every((name) => field(item, name)) && field(item, 'guid') === field(item, 'link') && RFC_822.test(field(item, 'pubDate') ?? '')),
    true,
  )
  const ours = items.find((item) => field(item, 'link') === new URL(`/learn/${slugs.live}`, site).href)
  expect('the title is escaped', ours ? field(ours, 'title') : null, `SEO check &amp; &lt;escape&gt; &quot;quotes&quot; &apos;apostrophe&apos; ${run}`)
  expect('the description is the escaped excerpt', ours ? field(ours, 'description') : null, `Fish &amp; chips &lt;b&gt;bold&lt;/b&gt; ${run}`)
  expect('no bare ampersand or unexpected tag reaches the XML', [/&(?!amp;|lt;|gt;|quot;|apos;)/.test(feed.body), feed.body.includes('<escape>')], [false, false])
  expect('the feed carries no article body', feed.body.includes(`SEO check body ${run}`), false)
  expect('a draft post is not in the feed', feed.body.includes(slugs.draft), false)
  expect('a noindex post is not in the feed', feed.body.includes(slugs.hidden), false)

  const feedLink = /<head>.*<link rel="alternate" type="application\/rss\+xml" href="\/learn\/rss.xml"[^>]*>.*<\/head>/s
  for (const path of ['/', '/learn', `/learn/${slugs.live}`, '/races']) {
    expect(`${path} advertises the feed in its head`, feedLink.test((await fetchText(path)).body), true)
  }
  expect('/learn links to the feed', (await fetchText('/learn')).body.includes('<a href="/learn/rss.xml">'), true)
}

type LdNode = Record<string, unknown> & { '@type'?: string; mainEntity?: LdNode }

const decode = (text: string) =>
  text.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function structuredDataCases() {
  const anyPublic = async (collection: 'athletes' | 'races', where: Where) =>
    (await payload.find({ collection, overrideAccess: false, depth: 0, limit: 1, where, sort: collection === 'races' ? 'dates.start' : 'name' })).docs[0]?.slug
  const athlete = await anyPublic('athletes', {})
  const race = await anyPublic('races', { 'dates.start': { greater_than_equal: today } })
  const pages: [string, string][] = [
    ['/', 'WebSite'],
    ['/about', 'AboutPage'],
    ['/coaching', 'WebPage'],
    ['/contact', 'ContactPage'],
    ['/races', 'CollectionPage'],
    ['/races/in/telangana', 'CollectionPage'],
    ['/races/discipline/trail', 'CollectionPage'],
    [`/races/${race}`, 'SportsEvent'],
    ['/learn', 'CollectionPage'],
    ['/learn/topic/beginner-running', 'CollectionPage'],
    [`/learn/${slugs.live}`, 'Article'],
    ['/videos', 'CollectionPage'],
    ['/videos/placeholder-video-running-form-drills', 'VideoObject'],
    ['/coaches/placeholder-coach-a', 'ProfilePage'],
    ['/plans', 'ItemList'],
    ['/plans/beginner-5k-placeholder', 'Course'],
    ['/resources', 'CollectionPage'],
    ['/athletes', 'CollectionPage'],
    [`/athletes/${athlete}`, 'ProfilePage'],
  ]
  for (const [path, type] of pages) {
    const { status, body } = await fetchText(path)
    const blocks = [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((match) => {
      try {
        return JSON.parse(match[1]!) as LdNode & { '@graph'?: LdNode[] }
      } catch {
        return null
      }
    })
    const nodes = blocks.flatMap((block) => (block ? (block['@graph'] ?? [block]) : []))
    const main = nodes.find((node) => node['@type'] === type)
    const named = main?.name ?? main?.headline ?? main?.mainEntity?.name
    const h1 = decode(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')
    const crumbs = nodes.some((node) => node['@type'] === 'BreadcrumbList')
    expect(
      `${path}: ${type} JSON-LD parses, names the page's heading, and has breadcrumbs`,
      [status, blocks.length, blocks.every((block) => block?.['@context'] === 'https://schema.org'), path === '/' || named === h1, path === '/' || crumbs],
      [200, 1, true, true, true],
    )
  }

  const home = (await fetchText('/')).body
  const homeNodes = [...home.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap(
    (match) => (JSON.parse(match[1]!) as { '@graph': LdNode[] })['@graph'],
  )
  const club = homeNodes.find((node) => node['@type'] === 'SportsOrganization') as
    | { name?: string; logo?: { url?: string }; sameAs?: string[]; description?: string }
    | undefined
  expect(
    'the home page carries the club with its logo, Instagram, and description',
    [club?.name, club?.logo?.url, club?.sameAs, club?.description?.startsWith('A focused community of runners')],
    ['Endurance Run Club', new URL('/brand/erc-logo-512.png', site).href, ['https://www.instagram.com/endurancerunclubindia/'], true],
  )
  const fullClubElsewhere = await Promise.all(pages.slice(1).map(async ([path]) => ((await fetchText(path)).body.includes('"sameAs":["https://www.instagram.com') ? path : null)))
  expect('the full club node appears on the home page only', fullClubElsewhere.filter(Boolean), [])
}

try {
  await createFixtures()
  await sitemapCases()
  await robotsCases()
  await feedCases()
  await structuredDataCases()
} finally {
  for (const id of created.posts) await payload.delete({ collection: 'posts', id })
  for (const id of created.videos) await payload.delete({ collection: 'videos', id })
  await payload.delete({ collection: 'staff', where: { email: { like: `seo-check-%-${run}@erc.invalid` } }, context: { skipRevalidation: true } })
}

console.log(failures.length === 0 ? 'All SEO checks passed' : `${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
