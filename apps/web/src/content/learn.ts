import config from '@payload-config'
import {
  parseClockDuration,
  parseSlug,
  parseVideoCategory,
  parseYouTubeId,
  readingMinutes,
  VIDEO_CATEGORIES,
  type Coach,
  type CoachProfile,
  type ContentLink,
  type CoverImage,
  type EditorialState,
  type HttpsUrl,
  type Id,
  type Instant,
  type ListPage,
  type Post,
  type PostSummary,
  type Reference,
  type Result,
  type Seo,
  type Topic,
  type Video,
  type VideoCategory,
  type VideoSummary,
  type YouTubeId,
} from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload, type Where } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { ErcSlug } from '@/cms/slugs'
import type { Coach as CoachDoc, Media, Post as PostDoc, Topic as TopicDoc, Video as VideoDoc } from '@/payload-types'

import { plainTextOf, wordCount } from './plain-text'
import { fail, mediaUrl, nonEmpty, parsing, richTextOf, slugOf, type Logger } from './published'

export const POSTS_PER_PAGE = 12
export const VIDEOS_PER_PAGE = 12
export const VIDEOS_PER_CATEGORY_PREVIEW = 6

export type TopicWithCount = Topic & { postCount: number }
export type VideoShelf = { category: VideoCategory; videos: readonly VideoSummary[]; total: number }
export type PostFilter = { kind: 'topic'; id: Id<'topics'> } | { kind: 'author'; id: Id<'coaches'> }

/**
 * Each read is tagged with every collection it reads, so a write to any of them expires it. The hour bounds staleness
 * from writes that bypass Payload.
 */
const cachedRead = <A extends unknown[], R>(key: string, reads: readonly ErcSlug[], read: (payload: Payload, ...args: A) => Promise<R>) =>
  unstable_cache(async (...args: A) => read(await getPayload({ config }), ...args), [key], {
    tags: reads.map(collectionTag),
    revalidate: 3600,
  })

const anonymous = { overrideAccess: false, draft: false } as const

/** Related posts and videos need only enough to link to them. */
const linkOnly = { posts: { title: true, slug: true }, videos: { title: true, slug: true } } as const

const readTopics = cachedRead('learn:topics', ['topics', 'posts'], async (payload): Promise<TopicWithCount[]> => {
  const { docs } = await payload.find({ collection: 'topics', ...anonymous, depth: 0, sort: ['order', 'title'], pagination: false })
  const topics = parseAll(docs, parseTopic, 'topic', payload)
  const counts = await Promise.all(
    topics.map((topic) => payload.count({ collection: 'posts', ...anonymous, where: { topics: { in: [topic.id] } } })),
  )
  return topics.map((topic, index) => ({ ...topic, postCount: counts[index]?.totalDocs ?? 0 }))
})

/** Published topics in their editorial order, each with its count of published posts. */
export const listTopics = cache(() => readTopics())

export const getTopic = cache(async (slug: string): Promise<TopicWithCount | null> => (await listTopics()).find((topic) => topic.slug === slug) ?? null)

const summaryFields = { title: true, slug: true, excerpt: true, cover: true, topics: true, authors: true, body: true, publishedAt: true, workflow: true, updatedAt: true } as const

const readPostPage = cachedRead(
  'learn:posts',
  ['posts', 'topics', 'coaches', 'media'],
  async (payload, filter: PostFilter | null, page: number): Promise<ListPage<PostSummary>> => {
    const where: Where = filter === null ? {} : filter.kind === 'topic' ? { topics: { in: [filter.id] } } : { authors: { in: [filter.id] } }
    const result = await payload.find({
      collection: 'posts',
      ...anonymous,
      where,
      select: summaryFields,
      depth: 2,
      sort: ['-publishedAt', '-id'],
      limit: POSTS_PER_PAGE,
      page,
    })
    return {
      items: parseAll(result.docs as PostDoc[], parsePostSummary, 'post', payload),
      total: result.totalDocs,
      page,
      totalPages: Math.max(1, result.totalPages),
    }
  },
)

/**
 * Published posts, newest first, optionally narrowed to a topic or an author. A page past the end gives the last page,
 * so `page` in the result can be lower than asked for; page 1 is read first so an unreachable page never becomes a
 * cache key.
 */
export const findPosts = cache(async (filter: PostFilter | null, page: number): Promise<ListPage<PostSummary>> => {
  const first = await readPostPage(filter, 1)
  const last = Math.min(page, first.totalPages)
  return last === 1 ? first : readPostPage(filter, last)
})

// Depth 0 is enough: the feed shows only the title, link, date and excerpt.
const readFeed = cachedRead('learn:feed', ['posts'], async (payload): Promise<PostSummary[]> => {
  const { docs } = await payload.find({
    collection: 'posts',
    ...anonymous,
    // Rows saved before the field existed hold null, which a plain not-equals would also drop.
    where: { or: [{ 'seo.noindex': { equals: false } }, { 'seo.noindex': { exists: false } }] },
    select: summaryFields,
    depth: 0,
    sort: ['-publishedAt', '-id'],
    limit: POSTS_PER_PAGE,
  })
  return parseAll(docs as PostDoc[], parsePostSummary, 'post', payload)
})

/** The newest published posts that search engines may index, for the article feed. */
export const feedPosts = cache(() => readFeed())

const publishedSlugs = (collection: 'posts' | 'videos' | 'coaches') =>
  cachedRead(`learn:${collection}:slugs`, [collection], async (payload): Promise<string[]> => {
    const { docs } = await payload.find({ collection, ...anonymous, depth: 0, select: { slug: true }, pagination: false })
    return docs.map((doc) => doc.slug)
  })

const postSlugs = publishedSlugs('posts')
const videoSlugs = publishedSlugs('videos')
const coachSlugs = publishedSlugs('coaches')

const readPost = cachedRead('learn:post', ['posts', 'videos', 'topics', 'coaches', 'media'], async (payload, slug: string) => {
  const { docs } = await payload.find({
    collection: 'posts',
    ...anonymous,
    where: { slug: { equals: slug } },
    depth: 2,
    populate: linkOnly,
    limit: 1,
    pagination: false,
  })
  return parseAll(docs, parsePost, 'post', payload)[0] ?? null
})

/**
 * A published post by slug, or null. Unknown slugs are answered from the cached slug list, so a made-up URL adds no
 * cache entry. `cache` shares one lookup between a page and its metadata.
 */
export const getPost = cache(async (slug: string): Promise<Post | null> => ((await postSlugs()).includes(slug) ? readPost(slug) : null))

const readCoach = cachedRead('learn:coach', ['coaches', 'media'], async (payload, slug: string) => {
  const { docs } = await payload.find({ collection: 'coaches', ...anonymous, where: { slug: { equals: slug } }, depth: 1, limit: 1, pagination: false })
  return parseAll(docs, parseCoach, 'coach', payload)[0] ?? null
})

export const getCoach = cache(async (slug: string): Promise<Coach | null> => ((await coachSlugs()).includes(slug) ? readCoach(slug) : null))

const videoSummaryFields = { title: true, slug: true, youtubeId: true, duration: true, category: true, publishedAt: true, workflow: true, updatedAt: true } as const

const readVideoPage = cachedRead('learn:videos', ['videos'], async (payload, category: VideoCategory, page: number, limit: number) => {
  const result = await payload.find({
    collection: 'videos',
    ...anonymous,
    where: { category: { equals: category } },
    select: videoSummaryFields,
    depth: 0,
    sort: ['-publishedAt', '-id'],
    limit,
    page,
  })
  return {
    items: parseAll(result.docs as VideoDoc[], parseVideoSummary, 'video', payload),
    total: result.totalDocs,
    page,
    totalPages: Math.max(1, result.totalPages),
  } satisfies ListPage<VideoSummary>
})

/** The newest few videos of each category that has any, in the brief's category order. */
export const listVideoShelves = cache(async (): Promise<VideoShelf[]> => {
  const shelves = await Promise.all(
    VIDEO_CATEGORIES.map(async ({ key }) => {
      const page = await readVideoPage(key, 1, VIDEOS_PER_CATEGORY_PREVIEW)
      return { category: key, videos: page.items, total: page.total }
    }),
  )
  return shelves.filter((shelf) => shelf.total > 0)
})

/** Published videos in one category, newest first; a page past the end gives the last page. */
export const findVideos = cache(async (category: VideoCategory, page: number): Promise<ListPage<VideoSummary>> => {
  const first = await readVideoPage(category, 1, VIDEOS_PER_PAGE)
  const last = Math.min(page, first.totalPages)
  return last === 1 ? first : readVideoPage(category, last, VIDEOS_PER_PAGE)
})

const readVideo = cachedRead('learn:video', ['videos', 'posts', 'topics', 'media'], async (payload, slug: string) => {
  const { docs } = await payload.find({
    collection: 'videos',
    ...anonymous,
    where: { slug: { equals: slug } },
    depth: 1,
    populate: linkOnly,
    limit: 1,
    pagination: false,
  })
  return parseAll(docs, parseVideo, 'video', payload)[0] ?? null
})

export const getVideo = cache(async (slug: string): Promise<Video | null> => ((await videoSlugs()).includes(slug) ? readVideo(slug) : null))

/** The video's thumbnail from YouTube's image host, fetched by the server so readers' browsers never contact YouTube. */
export const youtubeThumbnail = async (youtubeId: YouTubeId): Promise<Response | null> => {
  const upstream = await fetch(`https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`, {
    next: { revalidate: 86_400, tags: [collectionTag('videos')] },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  return upstream?.ok ? upstream : null
}

function parseAll<D extends { id: number }, T>(docs: readonly D[], parse: (doc: D) => T, kind: string, payload: { logger: Logger }): T[] {
  return docs.flatMap((doc) => {
    const parsed = parsing(() => parse(doc))
    if (parsed.ok) return [parsed.value]
    payload.logger.error({ [kind]: doc.id, field: parsed.error }, `Skipping a ${kind} that does not parse`)
    return []
  })
}

const richTextOrNull = (value: object | null | undefined) => (value == null ? null : richTextOf(value))

const required = <T,>(result: Result<T, string>, field: string): T => (result.ok ? result.value : fail(field))

const httpsUrl = (value: string | null | undefined): HttpsUrl | null => {
  try {
    if (value && new URL(value).protocol === 'https:') return value as HttpsUrl
  } catch {
    // Not a URL at all; treated like a non-https one.
  }
  return null
}

/** Populated relations come back as documents; anything the reader may not see comes back as a bare id. */
const visible = <T,>(values: readonly (number | T)[] | null | undefined): T[] =>
  (values ?? []).filter((value): value is T => typeof value === 'object' && value !== null)

const coverOf = (media: number | Media | null | undefined): CoverImage | null => {
  if (typeof media !== 'object' || media === null) return null
  const url = mediaUrl(media)
  return url && media.width && media.height ? { url, alt: media.alt, width: media.width, height: media.height } : null
}

const liveAt = (workflow: unknown): Instant | null => {
  const live = (workflow as EditorialState | null | undefined)?.live
  return live?.kind === 'published' ? live.at : null
}

/** First publication and last republication. Rows written before `publishedAt` existed fall back to the workflow. */
const datesOf = (doc: { publishedAt?: string | null; workflow?: unknown; updatedAt: string }) => {
  const updatedAt = liveAt(doc.workflow) ?? (doc.updatedAt as Instant)
  return { publishedAt: (doc.publishedAt as Instant | null | undefined) ?? updatedAt, updatedAt }
}

const parseTopic = (doc: TopicDoc): Topic => ({
  id: doc.id as Id<'topics'>,
  slug: slugOf(doc.slug),
  title: nonEmpty(doc.title, 'title'),
  description: doc.description,
  order: doc.order,
})

const parseCoachProfile = (doc: CoachDoc): CoachProfile => ({
  id: doc.id as Id<'coaches'>,
  slug: slugOf(doc.slug),
  name: nonEmpty(doc.name, 'name'),
  credentials: doc.credentials,
  photoUrl: mediaUrl(doc.photo),
})

const parseCoach = (doc: CoachDoc): Coach => ({ ...parseCoachProfile(doc), bio: richTextOrNull(doc.bio) })

const seoOf = (doc: Pick<PostDoc, 'seo' | 'title'>, fallbackDescription: string, fallbackImage: HttpsUrl | null): Seo => ({
  title: doc.seo?.title?.trim() || doc.title,
  description: doc.seo?.description?.trim() || fallbackDescription,
  imageUrl: mediaUrl(doc.seo?.image) ?? fallbackImage,
  noindex: doc.seo?.noindex ?? false,
})

const referenceOf = (reference: NonNullable<PostDoc['references']>[number], index: number): Reference => ({
  title: nonEmpty(reference.title, `references.${index}.title`),
  url: httpsUrl(reference.url) ?? fail(`references.${index}.url`),
  publisher: reference.publisher?.trim() || null,
})

const linkTo = (kind: ContentLink['kind'], doc: { slug?: string | null; title?: string | null }): ContentLink[] => {
  const slug = parseSlug(doc.slug ?? '')
  return slug.ok && doc.title ? [{ kind, slug: slug.value, title: doc.title } as ContentLink] : []
}

const relatedOf = (related: PostDoc['related']): ContentLink[] =>
  (related ?? []).flatMap((item) => (typeof item.value === 'object' ? linkTo(item.relationTo === 'posts' ? 'post' : 'video', item.value) : []))

const parsePostSummary = (doc: PostDoc): PostSummary => ({
  kind: 'post',
  slug: slugOf(doc.slug),
  title: nonEmpty(doc.title, 'title'),
  excerpt: doc.excerpt,
  cover: coverOf(doc.cover),
  topics: visible(doc.topics).map(parseTopic),
  authors: visible(doc.authors).map(parseCoachProfile),
  publishedAt: datesOf(doc).publishedAt,
  readingMinutes: readingMinutes(wordCount(plainTextOf(richTextOf(doc.body)))),
})

const parsePost = (doc: PostDoc): Post => {
  const summary = parsePostSummary(doc)
  return {
    ...summary,
    ...datesOf(doc),
    body: richTextOf(doc.body),
    references: (doc.references ?? []).map(referenceOf),
    related: relatedOf(doc.related),
    seo: seoOf(doc, doc.excerpt, summary.cover?.url ?? null),
  }
}

const parseVideoSummary = (doc: VideoDoc): VideoSummary => ({
  kind: 'video',
  slug: slugOf(doc.slug),
  title: nonEmpty(doc.title, 'title'),
  youtubeId: required(parseYouTubeId(doc.youtubeId), 'youtubeId'),
  duration: required(parseClockDuration(doc.duration), 'duration'),
  category: parseVideoCategory(doc.category) ?? fail('category'),
  publishedAt: datesOf(doc).publishedAt,
})

const parseVideo = (doc: VideoDoc): Video => {
  const description = richTextOf(doc.description)
  return {
    ...parseVideoSummary(doc),
    ...datesOf(doc),
    description,
    transcript: richTextOrNull(doc.transcript),
    topics: visible(doc.topics).map(parseTopic),
    related: visible(doc.relatedPosts).flatMap((post) => linkTo('post', post)),
    seo: seoOf(doc, plainTextOf(description), null),
  }
}
