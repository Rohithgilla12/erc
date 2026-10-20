import {
  parseSlug,
  type CoachProfile,
  type EditorialState,
  type HttpsUrl,
  type Id,
  type Instant,
  type RichText,
  type Seo,
  type Slug,
} from '@erc/domain'

import type { Coach as CoachDoc, Media as MediaDoc } from '@/payload-types'
import { absoluteUrl, siteConfig } from '@/site-config'

export type Logger = { error: (details: object, message: string) => void }

/** Thrown by the field readers below and caught by each document parser, which reports the field instead. */
export class InvalidField extends Error {}

export const fail = (field: string): never => {
  throw new InvalidField(field)
}

export const present = <T,>(value: T | null | undefined, field: string): T => (value == null ? fail(field) : value)

export const nonEmpty = (value: string | null | undefined, field: string): string => (value?.trim() ? value.trim() : fail(field))

export const slugOf = (value: string): Slug => {
  const parsed = parseSlug(value)
  return parsed.ok ? parsed.value : fail('slug')
}

/** Runs a parser built from the readers above, turning a bad field into a result that names it. */
export const parsing = <T,>(parse: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: parse() }
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, error: error.message }
    throw error
  }
}

/**
 * The one rule for an uploaded image's address. R2 gives an absolute https URL; local storage gives a path on this
 * site, which resolves against the site URL and is accepted as the site's own origin, plain http in development
 * included. Anything else, or a relation the reader may not see, is no image.
 */
export const mediaUrl = (media: number | MediaDoc | null | undefined): HttpsUrl | null => {
  if (typeof media !== 'object' || !media?.url) return null
  try {
    const url = new URL(absoluteUrl(media.url))
    return url.protocol === 'https:' || url.origin === siteConfig().siteUrl.origin ? (url.href as HttpsUrl) : null
  } catch {
    return null
  }
}

type EditorialDoc = {
  slug: string
  updatedAt: string
  workflow?: unknown
  seo?: { title?: string | null; description?: string | null; image?: number | MediaDoc | null; noindex?: boolean | null }
}

/** The fields every published editorial document shares. Empty SEO fields fall back to the page's own text. */
export const publishedFields = (doc: EditorialDoc, fallback: { title: string; description: string }) => {
  const live = (doc.workflow as EditorialState | undefined)?.live
  return {
    slug: slugOf(doc.slug),
    publishedAt: (live?.kind === 'published' ? live.at : fail('workflow.live')) as Instant,
    updatedAt: present(doc.updatedAt, 'updatedAt') as Instant,
    seo: {
      title: doc.seo?.title?.trim() || fallback.title,
      description: doc.seo?.description?.trim() || fallback.description,
      imageUrl: mediaUrl(doc.seo?.image),
      noindex: doc.seo?.noindex ?? false,
    } satisfies Seo,
  }
}

/** Lexical JSON is opaque to the domain; only `rich-text.tsx` looks inside it. */
export const richTextOf = (value: object): RichText => value as unknown as RichText

/** Unpublished coaches arrive as bare ids because anonymous reads cannot populate them; they are left out. */
export const publishedCoaches = (coaches: readonly (number | CoachDoc)[]): CoachProfile[] =>
  coaches.flatMap((coach) =>
    typeof coach === 'object' && coach._status === 'published'
      ? [
          {
            id: coach.id as Id<'coaches'>,
            slug: slugOf(coach.slug),
            name: coach.name,
            credentials: coach.credentials,
            photoUrl: mediaUrl(coach.photo),
          },
        ]
      : [],
  )
