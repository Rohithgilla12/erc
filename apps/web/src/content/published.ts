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

const httpsUrlOrNull = (value: string | null | undefined): HttpsUrl | null => {
  try {
    return value && new URL(value).protocol === 'https:' ? (value as HttpsUrl) : null
  } catch {
    return null
  }
}

/** An image only counts once it is on an https URL; local-disk media in development has a relative one. */
const imageUrlOf = (image: number | MediaDoc | null | undefined) => (typeof image === 'object' && image ? httpsUrlOrNull(image.url) : null)

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
      imageUrl: imageUrlOf(doc.seo?.image),
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
            photoUrl: imageUrlOf(coach.photo),
          },
        ]
      : [],
  )
