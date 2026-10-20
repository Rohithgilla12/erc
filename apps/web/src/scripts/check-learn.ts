/**
 * Proves the learning centre's write rules, visibility, player, and structured data against a migrated database:
 * `pnpm payload run src/scripts/check-learn.ts`. Run `seed-learn.ts` first, and set `ERC_CHECK_URL` to a running site
 * (for example `http://localhost:3000`) to add the route, REST, player, and JSON-LD cases. Everything it writes is
 * removed.
 */
import config from '@payload-config'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import type { Staff } from '@/payload-types'

const payload = await getPayload({ config })
const run = Date.now()
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const outcome = (write: Promise<unknown>) =>
  write.then(
    () => 'allowed',
    (error: { status?: number; message?: string }) => error.status ?? error.message,
  )

type StaffUser = Staff & { collection: 'staff' }

const system = () => ({ context: { skipRevalidation: true } })
// Writes the site must see go through the normal hooks, so the running site's cache is expired as in production.
const as = (user: StaffUser) => ({ user, overrideAccess: false })

const createStaff = async (role: Staff['role']): Promise<StaffUser> => {
  const doc = await payload.create({
    collection: 'staff',
    data: { email: `learn-check-${role}-${run}@erc.invalid`, password: `pw-${run}-check`, role },
    ...system(),
  })
  return { ...doc, collection: 'staff' }
}

const author = await createStaff('author')
const editor = await createStaff('editor')
const created = { posts: [] as number[], videos: [] as number[] }

const seededTopic = (await payload.find({ collection: 'topics', where: { slug: { equals: 'beginner-running' } }, limit: 1 })).docs[0]
const seededCoach = (await payload.find({ collection: 'coaches', where: { slug: { equals: 'placeholder-coach-a' } }, limit: 1 })).docs[0]
if (!seededTopic || !seededCoach) throw new Error('Run src/scripts/seed-learn.ts first')

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

const postData = (slug: string, title: string): RequiredDataFromCollectionSlug<'posts'> => ({
  title,
  slug,
  excerpt: `Check excerpt ${run}`,
  topics: [seededTopic.id],
  authors: [seededCoach.id],
  body: paragraph(`Check body ${run}`),
})

const LINKED_SLUG = 'placeholder-reading-an-easy-pace'

const withInternalLink = (postId: number) => {
  const body = paragraph('Check link: ')
  const link = {
    type: 'link',
    version: 3,
    direction: 'ltr',
    format: '',
    indent: 0,
    fields: { linkType: 'internal', newTab: false, doc: { relationTo: 'posts', value: postId } },
    children: [{ type: 'text', version: 1, text: 'internal link' }],
  }
  ;(body.root.children[0]!.children as object[]).push(link)
  return body
}

const anonymousTitles = async (slug: string, draft: boolean) => {
  const { docs } = await payload.find({ collection: 'posts', overrideAccess: false, draft, where: { slug: { equals: slug } } })
  return docs.map((post) => post.title)
}

const draftSlug = `learn-check-draft-${run}`
const liveSlug = `learn-check-live-${run}`
const goneSlug = `learn-check-gone-${run}`
const liveTitle = `Learn check live ${run}`
const revisionTitle = `Learn check unpublished revision ${run}`

async function writeCases() {
  const draft = await payload.create({ collection: 'posts', data: postData(draftSlug, `Learn check draft ${run}`), draft: true, ...as(author) })
  created.posts.push(draft.id)
  expect('a never-published post is invisible to anonymous reads', await anonymousTitles(draftSlug, false), [])
  expect('a never-published post is invisible to anonymous draft reads', await anonymousTitles(draftSlug, true), [])

  const linked = (await payload.find({ collection: 'posts', where: { slug: { equals: LINKED_SLUG } }, limit: 1 })).docs[0]
  if (!linked) throw new Error('Run src/scripts/seed-learn.ts first')
  const live = await payload.create({
    collection: 'posts',
    data: { ...postData(liveSlug, liveTitle), body: withInternalLink(linked.id), _status: 'published' },
    ...as(editor),
  })
  created.posts.push(live.id)
  expect('publishing stamps the first publication time', typeof live.publishedAt === 'string', true)
  await payload.update({ collection: 'posts', id: live.id, data: { title: revisionTitle }, draft: true, ...as(author) })
  expect('anonymous reads get the live copy, not the revision', await anonymousTitles(liveSlug, false), [liveTitle])
  expect('anonymous draft reads never return the unpublished revision', (await anonymousTitles(liveSlug, true)).includes(revisionTitle), false)
  const republished = await payload.update({ collection: 'posts', id: live.id, data: { title: liveTitle, _status: 'published' }, ...as(editor) })
  expect('republishing keeps the first publication time', republished.publishedAt, live.publishedAt)
  await payload.update({ collection: 'posts', id: live.id, data: { title: revisionTitle }, draft: true, ...as(author) })

  expect(
    'a post cannot take the /learn/topic route segment',
    await outcome(payload.create({ collection: 'posts', data: { ...postData('topic', 'Topic'), _status: 'published' }, ...as(editor) })),
    400,
  )

  const video = await payload.create({
    collection: 'videos',
    data: {
      title: `Learn check video ${run}`,
      slug: `learn-check-video-${run}`,
      youtubeId: 'https://www.youtube.com/watch?v=placehold-z&t=10s',
      duration: ' 65 ',
      category: 'technique',
      description: paragraph('Check description'),
      _status: 'published',
    },
    ...as(editor),
  })
  created.videos.push(video.id)
  expect('a pasted YouTube link is stored as its id', video.youtubeId, 'placehold-z')
  expect('a length in seconds is stored in clock form', video.duration, '1:05')
  expect(
    'a non-YouTube link is refused',
    await outcome(
      payload.create({
        collection: 'videos',
        data: { title: 'Vimeo', slug: `learn-check-vimeo-${run}`, youtubeId: 'https://vimeo.com/123456', duration: '1:00', category: 'technique', description: paragraph('x') },
        ...as(editor),
      }),
    ),
    400,
  )
}

const html = async (site: string, path: string) => {
  const response = await fetch(new URL(path, site), { redirect: 'manual' })
  return { status: response.status, location: response.headers.get('location'), body: await response.text() }
}

const jsonLd = (body: string): Record<string, unknown>[] =>
  [...body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].flatMap((match) => {
    const parsed = JSON.parse(match[1]!) as { '@graph'?: Record<string, unknown>[] } & Record<string, unknown>
    return parsed['@graph'] ?? [parsed]
  })

const ofType = <T,>(body: string, type: string) => jsonLd(body).find((node) => node['@type'] === type) as T | undefined

type ArticleLd = {
  headline?: unknown
  datePublished?: unknown
  dateModified?: unknown
  author?: { '@type': string; name: string }[]
  publisher?: { '@type'?: string; name?: string; logo?: { url?: unknown } }
}
type VideoLd = { name?: unknown; description?: unknown; thumbnailUrl?: string[]; uploadDate?: unknown; duration?: string; embedUrl?: string }

const robotsOf = (body: string) => /<meta name="robots" content="([^"]*)"/.exec(body)?.[1] ?? null
const canonicalOf = (body: string) => /<link rel="canonical" href="([^"]*)"/.exec(body)?.[1] ?? null

/** Every URL the browser would fetch on load: `src`, `srcset`, `<link href>`, and iframes. Plain `<a href>` is excluded. */
const loadedUrls = (body: string) => [
  ...[...body.matchAll(/\s(?:src|srcSet|srcset)="([^"]*)"/g)].map((match) => match[1]!),
  ...[...body.matchAll(/<link[^>]*\shref="([^"]*)"/g)].map((match) => match[1]!),
]

const YOUTUBE_HOSTS = /youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com|youtu\.be/

async function siteCases(site: string) {
  const SEEDED_POST = '/learn/placeholder-planning-a-first-ultra'
  const SEEDED_VIDEO = '/videos/placeholder-video-running-form-drills'
  const SEEDED_COACH = '/coaches/placeholder-coach-a'

  for (const path of ['/learn', '/learn/topic/beginner-running', SEEDED_POST, '/videos', '/videos?category=technique', SEEDED_VIDEO, `${SEEDED_VIDEO}?play=1`, SEEDED_COACH]) {
    expect(`route ${path} renders`, (await html(site, path)).status, 200)
  }
  for (const path of ['/learn/no-such-post', '/learn/topic/no-such-topic', '/videos/no-such-video', '/coaches/no-such-coach', '/videos?category=cooking', '/videos/no-such-video/thumbnail.jpg']) {
    expect(`route ${path} is a 404`, (await html(site, path)).status, 404)
  }
  const thumbnail = await fetch(new URL(`${SEEDED_VIDEO}/thumbnail.jpg`, site))
  expect('a published video’s thumbnail is served from this site', [thumbnail.status, thumbnail.headers.get('content-type')?.startsWith('image/')], [200, true])
  const pastTheEnd = await html(site, '/learn/topic/beginner-running?page=40')
  expect('a page past the end redirects to the last page', [pastTheEnd.status, pastTheEnd.location], [307, '/learn/topic/beginner-running'])

  const learn = await html(site, '/learn')
  const topicTitles = [
    'Beginner running',
    'Training plans and pacing',
    'Heart rate, Zone 2 and MAF',
    'Marathon and ultra preparation',
    'Strength, mobility and recovery',
    'Nutrition, hydration and running in hot weather',
    'Race reports and athlete stories',
  ]
  expect('/learn lists the seven topic clusters', topicTitles.filter((title) => learn.body.includes(`>${title}</a>`)).length, 7)

  expect('route: a never-published post is a 404', (await html(site, `/learn/${draftSlug}`)).status, 404)
  const live = await html(site, `/learn/${liveSlug}`)
  expect('route: a post with a pending revision shows the live title', [live.status, live.body.includes(liveTitle)], [200, true])
  expect('route: the unpublished revision never appears', live.body.includes(revisionTitle), false)
  expect('route: an internal link in the body points at the linked post', live.body.includes(`href="/learn/${LINKED_SLUG}"`), true)

  const rest = async (query: string) => {
    const response = await fetch(new URL(`/api/posts${query}`, site))
    return { status: response.status, text: await response.text() }
  }
  const restDraft = await rest(`?where[slug][equals]=${draftSlug}`)
  expect('REST: a never-published post is not listed', [restDraft.status, JSON.parse(restDraft.text).totalDocs], [200, 0])
  const restDraftDraft = await rest(`?where[slug][equals]=${draftSlug}&draft=true`)
  expect('REST: a never-published post is not listed with ?draft=true', JSON.parse(restDraftDraft.text).totalDocs, 0)
  expect('REST: the revision is absent from the anonymous list', (await rest(`?where[slug][equals]=${liveSlug}`)).text.includes(revisionTitle), false)
  expect('REST: the revision is absent with ?draft=true', (await rest(`?where[slug][equals]=${liveSlug}&draft=true`)).text.includes(revisionTitle), false)
  expect('REST: by id, a never-published post is refused', (await rest(`/${created.posts[0]}`)).status, 404)
  const liveId = created.posts[1]
  expect('REST: by id with ?draft=true, the revision is absent', (await rest(`/${liveId}?draft=true`)).text.includes(revisionTitle), false)
  const versions = await rest(`/versions?where[parent][equals]=${liveId}`)
  expect('REST: anonymous version history is refused', [versions.status >= 400, versions.text.includes(revisionTitle)], [true, false])

  const gone = await payload.create({ collection: 'posts', data: { ...postData(goneSlug, `Learn check gone ${run}`), _status: 'published' }, ...as(editor) })
  created.posts.push(gone.id)
  expect('route: a published post renders', (await html(site, `/learn/${goneSlug}`)).status, 200)
  await payload.update({ collection: 'posts', id: gone.id, data: { _status: 'draft' }, ...as(editor) })
  expect('route: an unpublished post is a 404 on the next request', (await html(site, `/learn/${goneSlug}`)).status, 404)

  const plain = await html(site, SEEDED_VIDEO)
  const playing = await html(site, `${SEEDED_VIDEO}?play=1`)
  expect('the plain video page has no iframe', plain.body.includes('<iframe'), false)
  expect('the plain video page loads nothing from YouTube', loadedUrls(plain.body).filter((url) => YOUTUBE_HOSTS.test(url)), [])
  expect('the plain video page is indexable', robotsOf(plain.body), null)
  expect('the play link goes to ?play=1', plain.body.includes(`href="${SEEDED_VIDEO}?play=1"`), true)
  expect(
    '?play=1 embeds the youtube-nocookie player',
    /<iframe[^>]*src="https:\/\/www\.youtube-nocookie\.com\/embed\/placehold-a\?/.test(playing.body),
    true,
  )
  expect('?play=1 is noindex', robotsOf(playing.body), 'noindex, follow')
  expect('?play=1 is canonical to the plain page', canonicalOf(playing.body), new URL(SEEDED_VIDEO, site).href)
  expect('the plain page is canonical to itself', canonicalOf(plain.body), new URL(SEEDED_VIDEO, site).href)

  const post = await html(site, SEEDED_POST)
  const articleLd = ofType<ArticleLd>(post.body, 'Article')
  expect(
    'Article JSON-LD has headline, dates, Person authors, and the club as publisher',
    [
      typeof articleLd?.headline,
      typeof articleLd?.datePublished,
      typeof articleLd?.dateModified,
      articleLd?.author?.map((a) => [a['@type'], a.name]),
      [articleLd?.publisher?.['@type'], articleLd?.publisher?.name, typeof articleLd?.publisher?.logo?.url],
    ],
    [
      'string',
      'string',
      'string',
      [
        ['Person', 'Placeholder Coach A'],
        ['Person', 'Placeholder Coach B'],
      ],
      ['SportsOrganization', 'Endurance Run Club', 'string'],
    ],
  )
  expect('the post page shows its references', post.body.includes('Placeholder reference one'), true)

  const videoLd = ofType<VideoLd>(plain.body, 'VideoObject')
  expect(
    'VideoObject JSON-LD has name, description, thumbnail, upload date, duration, and embed URL',
    [
      typeof videoLd?.name,
      typeof videoLd?.description,
      String(videoLd?.thumbnailUrl?.[0]).startsWith(site),
      typeof videoLd?.uploadDate,
      videoLd?.duration,
      videoLd?.embedUrl,
    ],
    ['string', 'string', true, 'string', 'PT4M12S', 'https://www.youtube-nocookie.com/embed/placehold-a'],
  )

  const coach = await html(site, SEEDED_COACH)
  const personLd = ofType<{ mainEntity?: { name?: string; url?: string } }>(coach.body, 'ProfilePage')?.mainEntity
  expect('Person JSON-LD has name and profile URL', [personLd?.name, personLd?.url], ['Placeholder Coach A', new URL(SEEDED_COACH, site).href])
  expect('the coach page lists their posts', coach.body.includes('Placeholder: planning a first ultra'), true)

  for (const [label, body] of [
    ['post', post.body],
    ['video', plain.body],
    ['coach', coach.body],
  ] as const) {
    const crumbs = ofType<{ itemListElement?: { position: number; item: string }[] }>(body, 'BreadcrumbList')
    const items = crumbs?.itemListElement ?? []
    expect(
      `${label} BreadcrumbList is ordered from home with absolute URLs`,
      [items.length >= 3, items.every((item, index) => item.position === index + 1 && item.item.startsWith(site))],
      [true, true],
    )
  }
}

try {
  await writeCases()
  const site = process.env.ERC_CHECK_URL
  if (site) await siteCases(site)
  else console.log('SKIP route, REST, player, and JSON-LD cases: set ERC_CHECK_URL to a running site')
} finally {
  for (const id of created.posts) await payload.delete({ collection: 'posts', id })
  for (const id of created.videos) await payload.delete({ collection: 'videos', id })
  await payload.delete({ collection: 'staff', where: { email: { like: `learn-check-%-${run}@erc.invalid` } }, ...system() })
}

console.log(failures.length === 0 ? 'All learning-centre checks passed' : `${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
