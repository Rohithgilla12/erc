import config from '@payload-config'
import {
  disciplineLandingPath,
  stateLandingPath,
  todayIn,
  type EditorialState,
  type Instant,
  type LocalDate,
} from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'

import { PRIVACY_NOTICE, SITE_SECTIONS } from '@/app/(frontend)/site-nav'
import { collectionTag } from '@/cms/revalidate'
import { EDITORIAL_SLUGS } from '@/cms/slugs'

import { listAthletes } from './athletes'
import { getPlans } from './plans'
import { getResources } from './resources'

/** One indexable URL. A null date means nothing records when it last changed, such as a built-in page. */
export type SitemapEntry = { path: string; lastModified: Instant | null }

const anonymous = { overrideAccess: false, draft: false, depth: 0, pagination: false } as const

type Dated = { updatedAt: string; workflow?: unknown }

/** When readers last saw a change: the last publish, not a later save of an unpublished revision. */
const changedAt = (doc: Dated): Instant => {
  const live = (doc.workflow as EditorialState | null | undefined)?.live
  return (live?.kind === 'published' ? live.at : doc.updatedAt) as Instant
}

const latest = (dates: readonly (Instant | null)[]): Instant | null =>
  dates.reduce<Instant | null>((newest, date) => (date !== null && (newest === null || date > newest) ? date : newest), null)

/** Keeps the newest date seen for each key, so a hub page is as fresh as the newest thing it lists. */
const newestBy = () => {
  const dates = new Map<string, Instant>()
  return {
    see: (key: string, date: Instant) => {
      const seen = dates.get(key)
      if (!seen || date > seen) dates.set(key, date)
    },
    of: (key: string) => dates.get(key) ?? null,
    keys: () => [...dates.keys()].sort(),
  }
}

const isIndexed = (doc: { seo?: { noindex?: boolean | null } | null }) => !doc.seo?.noindex

async function editorialEntries(payload: Payload) {
  const [posts, videos, topics, coaches, pages] = await Promise.all([
    payload.find({ collection: 'posts', ...anonymous, select: { slug: true, topics: true, authors: true, updatedAt: true, workflow: true, seo: { noindex: true } } }),
    payload.find({ collection: 'videos', ...anonymous, select: { slug: true, updatedAt: true, workflow: true, seo: { noindex: true } } }),
    payload.find({ collection: 'topics', ...anonymous, select: { slug: true, updatedAt: true, workflow: true } }),
    payload.find({ collection: 'coaches', ...anonymous, select: { slug: true, updatedAt: true, workflow: true } }),
    payload.find({ collection: 'pages', ...anonymous, select: { slug: true, updatedAt: true, workflow: true, seo: { noindex: true } } }),
  ])
  const byTopic = newestBy()
  const byCoach = newestBy()
  for (const post of posts.docs) {
    for (const topic of post.topics) byTopic.see(String(typeof topic === 'object' ? topic.id : topic), changedAt(post))
    for (const coach of post.authors) byCoach.see(String(typeof coach === 'object' ? coach.id : coach), changedAt(post))
  }
  const indexedPosts = posts.docs.filter(isIndexed)
  const indexedVideos = videos.docs.filter(isIndexed)
  const pageBySlug = new Map(pages.docs.map((page) => [page.slug, page]))
  const sitePage = (slug: string, path: string): SitemapEntry[] => {
    const page = pageBySlug.get(slug)
    if (page && !isIndexed(page)) return []
    return [{ path, lastModified: page ? changedAt(page) : null }]
  }
  return {
    learn: latest(indexedPosts.map(changedAt)),
    videos: latest(indexedVideos.map(changedAt)),
    sitePage,
    entries: [
      ...indexedPosts.map((post) => ({ path: `/learn/${post.slug}`, lastModified: changedAt(post) })),
      ...indexedVideos.map((video) => ({ path: `/videos/${video.slug}`, lastModified: changedAt(video) })),
      ...topics.docs.map((topic) => ({ path: `/learn/topic/${topic.slug}`, lastModified: latest([changedAt(topic), byTopic.of(String(topic.id))]) })),
      ...coaches.docs.map((coach) => ({ path: `/coaches/${coach.slug}`, lastModified: latest([changedAt(coach), byCoach.of(String(coach.id))]) })),
    ],
  }
}

/** Upcoming approved races, and the landing page of each discipline and state that has one. */
async function raceEntries(payload: Payload, today: LocalDate) {
  const { docs } = await payload.find({
    collection: 'races',
    ...anonymous,
    // Read access already hides unapproved races; the calendar's rule is to state it wherever races are listed.
    where: { and: [{ 'moderation.state': { equals: 'approved' } }, { 'dates.start': { greater_than_equal: today } }] },
    select: { slug: true, discipline: true, location: true, updatedAt: true },
    sort: 'dates.start',
  })
  const byLanding = newestBy()
  for (const race of docs) {
    const at = race.updatedAt as Instant
    byLanding.see(disciplineLandingPath(race.discipline), at)
    if (race.location.kind === 'venue' && race.location.subdivision) byLanding.see(stateLandingPath(race.location.subdivision), at)
  }
  return {
    calendar: latest(docs.map((race) => race.updatedAt as Instant)),
    entries: [
      ...byLanding.keys().map((path) => ({ path, lastModified: byLanding.of(path) })),
      ...docs.map((race) => ({ path: `/races/${race.slug}`, lastModified: race.updatedAt as Instant })),
    ],
  }
}

async function athleteEntries(payload: Payload) {
  // The directory read decides who is public; this read only dates them.
  const [directory, { docs }] = await Promise.all([
    listAthletes(),
    payload.find({ collection: 'athletes', ...anonymous, select: { slug: true, updatedAt: true } }),
  ])
  const updated = new Map(docs.map((doc) => [doc.slug, doc.updatedAt as Instant]))
  return directory.map(({ athlete }) => ({ path: `/athletes/${athlete.slug}`, lastModified: updated.get(athlete.slug) ?? null }))
}

async function readSitemap(today: LocalDate): Promise<SitemapEntry[]> {
  const payload = await getPayload({ config })
  const [editorial, races, athletes, plans, resources] = await Promise.all([
    editorialEntries(payload),
    raceEntries(payload, today),
    athleteEntries(payload),
    getPlans(),
    getResources(),
  ])
  const indexedPlans = plans.filter((plan) => !plan.seo.noindex)
  const sectionDates: Readonly<Record<string, Instant | null>> = {
    '/races': races.calendar,
    '/learn': editorial.learn,
    '/videos': editorial.videos,
    '/plans': latest(indexedPlans.map((plan) => plan.updatedAt)),
    '/athletes': latest(athletes.map((entry) => entry.lastModified)),
  }
  const sitePages: Readonly<Record<string, string>> = { '/coaching': 'coaching', '/about': 'about', '/contact': 'contact' }
  return [
    ...editorial.sitePage('home', '/'),
    ...SITE_SECTIONS.flatMap(({ href }) => {
      const slug = sitePages[href]
      return slug ? editorial.sitePage(slug, href) : [{ path: href, lastModified: sectionDates[href] ?? null }]
    }),
    { path: '/resources', lastModified: latest(resources.map((resource) => resource.updatedAt)) },
    { path: PRIVACY_NOTICE.href, lastModified: new Date(PRIVACY_NOTICE.updated).toISOString() as Instant },
    ...races.entries,
    ...editorial.entries,
    ...indexedPlans.map((plan) => ({ path: `/plans/${plan.slug}`, lastModified: plan.updatedAt })),
    ...athletes,
  ]
}

const cachedSitemap = unstable_cache(readSitemap, ['sitemap'], {
  tags: [...EDITORIAL_SLUGS, ...(['races', 'athletes', 'results'] as const)].map(collectionTag),
  revalidate: 3600,
})

/**
 * Every indexable public URL with when it last changed. Unpublished, unapproved, hidden, and `noindex` documents never
 * appear, and neither do filtered or paginated views, whose canonical links point at a URL listed here. Keyed on
 * today's IST date, so races drop out the day after they start.
 */
export const sitemapEntries = () => cachedSitemap(todayIn('Asia/Kolkata'))
