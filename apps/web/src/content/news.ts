import config from '@payload-config'
import { parseLocalDate, type HttpsUrl, type Id, type Instant, type ListPage, type LocalDate, type Slug } from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { News as NewsDoc } from '@/payload-types'

import { fail, nonEmpty, parsing, slugOf, type Logger } from './published'

export const NEWS_PER_PAGE = 12

export const newsPath = (item: { slug: string }) => `/news/${item.slug}`

/** A published news item. `race` is set only while the related race is approved, so a link never leads to a 404. */
export type NewsItem = {
  id: Id<'news'>
  slug: Slug
  headline: string
  summary: string
  sourceUrl: HttpsUrl
  sourceName: string
  publishedOn: LocalDate
  race: { slug: Slug; name: string } | null
  updatedAt: Instant
}

// The related race is a record, so the race tag is here too: unapproving a race takes its link off cached news.
const cachedRead = <A extends unknown[], R>(key: string, read: (payload: Payload, ...args: A) => Promise<R>) =>
  unstable_cache(async (...args: A) => read(await getPayload({ config }), ...args), [key], {
    tags: [collectionTag('news'), collectionTag('races')],
    revalidate: 3600,
  })

const anonymous = { overrideAccess: false, draft: false, depth: 1 } as const

const httpsUrl = (value: string | null | undefined, field: string): HttpsUrl => {
  try {
    if (value && new URL(value).protocol === 'https:') return value as HttpsUrl
  } catch {
    // An unparseable URL fails the same way as a non-https one.
  }
  return fail(field)
}

const raceOf = (race: NewsDoc['relatedRace']): NewsItem['race'] =>
  typeof race === 'object' && race !== null && race.moderation.state === 'approved' ? { slug: slugOf(race.slug), name: race.name } : null

/** The one mapping from a CMS document to a public news item. */
export const parseNewsDoc = (doc: NewsDoc) =>
  parsing(
    (): NewsItem => {
      const publishedOn = parseLocalDate(doc.publishedOn ?? '')
      return {
        id: doc.id as Id<'news'>,
        slug: slugOf(doc.slug),
        headline: nonEmpty(doc.headline, 'headline'),
        summary: nonEmpty(doc.summary, 'summary'),
        sourceUrl: httpsUrl(doc.sourceUrl, 'sourceUrl'),
        sourceName: nonEmpty(doc.sourceName, 'sourceName'),
        publishedOn: publishedOn.ok ? publishedOn.value : fail('publishedOn'),
        race: raceOf(doc.relatedRace),
        updatedAt: doc.updatedAt as Instant,
      }
    },
  )

const parseAll = (docs: readonly NewsDoc[], logger: Logger) =>
  docs.flatMap((doc) => {
    const parsed = parseNewsDoc(doc)
    if (parsed.ok) return [parsed.value]
    logger.error({ news: doc.id, slug: doc.slug, field: parsed.error }, 'Skipping a news item that does not parse')
    return []
  })

/** Uncached; pages call `findNews`. Exported for scripts that run outside Next.js. */
export async function queryNews(payload: Payload, page: number, limit = NEWS_PER_PAGE): Promise<ListPage<NewsItem>> {
  const result = await payload.find({ collection: 'news', ...anonymous, sort: ['-publishedOn', '-id'], limit, page })
  return { items: parseAll(result.docs, payload.logger), total: result.totalDocs, page, totalPages: Math.max(1, result.totalPages) }
}

const readNewsPage = cachedRead('news:list', queryNews)

/** Published news, newest first. A page past the end gives the last page; page 1 is read first so it never becomes a key. */
export const findNews = cache(async (page: number): Promise<ListPage<NewsItem>> => {
  const first = await readNewsPage(1)
  const last = Math.min(page, first.totalPages)
  return last === 1 ? first : readNewsPage(last)
})

const readSlugs = cachedRead('news:slugs', async (payload): Promise<string[]> => {
  const { docs } = await payload.find({ collection: 'news', ...anonymous, depth: 0, pagination: false, select: { slug: true } })
  return docs.map((doc) => doc.slug)
})

/** Uncached; pages call `getNewsItem`. Exported for scripts that run outside Next.js. */
export async function newsBySlug(payload: Payload, slug: string): Promise<NewsItem | null> {
  const { docs } = await payload.find({ collection: 'news', ...anonymous, where: { slug: { equals: slug } }, limit: 1, pagination: false })
  return parseAll(docs, payload.logger)[0] ?? null
}

const readItem = cachedRead('news:get', newsBySlug)

/** A published item by slug. Unknown slugs are answered from the cached slug list, so a made-up URL adds no cache entry. */
export const getNewsItem = cache(async (slug: string): Promise<NewsItem | null> => ((await readSlugs()).includes(slug) ? readItem(slug) : null))
