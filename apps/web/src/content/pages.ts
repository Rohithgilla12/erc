import config from '@payload-config'
import {
  parseLinkHref,
  parseRaceQuery,
  parseSlug,
  todayIn,
  type CoachProfile,
  type CtaLink,
  type HttpsUrl,
  type Id,
  type PublicRace,
  type RichText,
  type Slug,
} from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { ErcSlug } from '@/cms/slugs'
import type { Coach as CoachDoc, Page as PageDoc } from '@/payload-types'

import { LINK_TARGETS, mediaUrl, type Logger } from './published'
import { findRaces } from './races'

export type PageBlock =
  | { kind: 'hero'; heading: string; body: string | null; primary: CtaLink | null; secondary: CtaLink | null }
  | { kind: 'richText'; body: RichText }
  | { kind: 'featuredRaces'; heading: string; count: number }
  | { kind: 'latestPosts'; heading: string; count: number }
  | { kind: 'featuredPlans'; heading: string; count: number }
  | { kind: 'callToAction'; heading: string; body: string | null; link: CtaLink }
  | { kind: 'coachGrid'; heading: string | null; coaches: readonly CoachProfile[] }
  | { kind: 'faq'; heading: string | null; items: readonly { question: string; answer: RichText }[] }

/** A null title or description means the route derives one from the page. */
export type PageSeo = { title: string | null; description: string | null; imageUrl: HttpsUrl | null; noindex: boolean }

export type SitePage = { slug: Slug; title: string; seo: PageSeo; blocks: readonly PageBlock[] }

/** Slugs with a route. Only these are read, so the cache holds at most one entry per slug. */
export type RoutedPageSlug = 'home' | 'about' | 'coaching' | 'contact'

// Coach cards, SEO images and rich-text links embed other documents, so a change to any of them expires the page too.
const cachedPageBySlug = unstable_cache(async (slug: RoutedPageSlug) => pageBySlug(await getPayload({ config }), slug), ['pages:get'], {
  tags: [...new Set<ErcSlug>(['pages', 'coaches', 'media', ...LINK_TARGETS])].map(collectionTag),
  revalidate: 3600,
})

/** The published page for a route, or null when none is published. `cache` shares one read between a page and its metadata. */
export const getPage = cache((slug: RoutedPageSlug): Promise<SitePage | null> => cachedPageBySlug(slug))

/** Uncached; routes call `getPage`. Exported for scripts that run outside Next.js. */
export async function pageBySlug(payload: Payload, slug: string): Promise<SitePage | null> {
  const { docs } = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    where: { slug: { equals: slug } },
    depth: 2,
    limit: 1,
    pagination: false,
  })
  const doc = docs[0]
  return doc ? parsePageDoc(doc, payload.logger) : null
}

export const upcomingRaces = async (count: number): Promise<readonly PublicRace[]> => {
  const { races } = await findRaces(parseRaceQuery({}, todayIn('Asia/Kolkata')))
  return races.slice(0, count)
}

type Block = PageDoc['layout'][number]

const textOrNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null)

const linkOf = (link: { label?: string | null; href?: string | null } | null | undefined): CtaLink | null => {
  const label = textOrNull(link?.label)
  const href = parseLinkHref(link?.href?.trim() ?? '')
  return label && href.ok ? { label, href: href.value } : null
}

// Relationships the reader may not see, such as an unpublished coach, arrive as bare ids and are left out.
const coachOf = (coach: number | CoachDoc): CoachProfile[] => {
  if (typeof coach === 'number') return []
  const slug = parseSlug(coach.slug)
  if (!slug.ok) return []
  return [
    {
      id: coach.id as Id<'coaches'>,
      slug: slug.value,
      name: coach.name,
      credentials: coach.credentials,
      photoUrl: mediaUrl(coach.photo),
    },
  ]
}

const richText = (value: unknown) => value as RichText

function blockOf(block: Block): PageBlock | null {
  switch (block.blockType) {
    case 'hero':
      return {
        kind: 'hero',
        heading: block.heading,
        body: textOrNull(block.body),
        primary: linkOf(block.primary),
        secondary: linkOf(block.secondary),
      }
    case 'richText':
      return { kind: 'richText', body: richText(block.body) }
    case 'featuredRaces':
    case 'latestPosts':
    case 'featuredPlans':
      return { kind: block.blockType, heading: block.heading, count: Math.min(12, Math.max(1, Math.trunc(block.count))) }
    case 'callToAction': {
      const link = linkOf(block.link)
      return link ? { kind: 'callToAction', heading: block.heading, body: textOrNull(block.body), link } : null
    }
    case 'coachGrid':
      return { kind: 'coachGrid', heading: textOrNull(block.heading), coaches: block.coaches.flatMap(coachOf) }
    case 'faq':
      return {
        kind: 'faq',
        heading: textOrNull(block.heading),
        items: block.items.map((item) => ({ question: item.question, answer: richText(item.answer) })),
      }
  }
}

export function parsePageDoc(doc: PageDoc, logger: Logger): SitePage | null {
  const slug = parseSlug(doc.slug)
  if (!slug.ok) {
    logger.error({ page: doc.id, slug: doc.slug }, 'Skipping a page whose slug does not parse')
    return null
  }
  const blocks = doc.layout.flatMap((block) => {
    const parsed = blockOf(block)
    if (!parsed) logger.error({ page: doc.id, block: block.id, blockType: block.blockType }, 'Skipping a page block that cannot render')
    return parsed ? [parsed] : []
  })
  return {
    slug: slug.value,
    title: doc.title,
    seo: {
      title: textOrNull(doc.seo?.title),
      description: textOrNull(doc.seo?.description),
      imageUrl: mediaUrl(doc.seo?.image),
      noindex: doc.seo?.noindex ?? false,
    },
    blocks,
  }
}
