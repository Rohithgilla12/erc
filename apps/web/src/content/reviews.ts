import config from '@payload-config'
import { subjectKeyOf, type HttpsUrl, type Id, type Instant, type Rating, type ReviewSubject, type ShoeCategory, type Slug } from '@erc/domain'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'

import { collectionTag } from '@/cms/revalidate'
import type { ErcSlug } from '@/cms/slugs'
import type { Shoe as ShoeDoc } from '@/payload-types'

import { mediaUrl } from './published'

/** Who wrote a review or asked a question, as the public sees them. `path` is set while their athlete profile is public. */
export type PublicAuthor = { name: string; path: string | null }

export type PublicReview = { id: number; author: PublicAuthor; rating: Rating; title: string; body: string; kmRun: number | null; yearRun: number | null; at: Instant }

export type PublicAnswer = { text: string; by: { name: string; path: string } | null; at: Instant | null }
export type PublicQuestion = { id: number; author: PublicAuthor; text: string; answer: PublicAnswer | null; at: Instant }

export type RatingSummary = { count: number; average: number | null }

export type PublicShoe = {
  id: Id<'shoes'>
  slug: Slug
  brand: string
  model: string
  category: ShoeCategory
  description: string
  image: { url: HttpsUrl; alt: string } | null
  rating: RatingSummary
}

const NO_RATINGS: RatingSummary = { count: 0, average: null }

/** Every public read here is tagged with the collections it joins, so a decision, an edit or a renamed athlete expires it. */
const cached = <A extends unknown[], R>(read: (...args: A) => Promise<R>, key: string, slugs: readonly ErcSlug[]) =>
  unstable_cache(read, [key], { tags: slugs.map(collectionTag), revalidate: 3600 })

const rowsOf = async <T>(payload: Payload, query: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(query)).rows as T[]

/**
 * The approved athlete name of the member, when they have chosen to show their profile, else "ERC member". This join
 * is the only place a review or question meets its member, and only the name and profile slug leave it.
 */
const authorColumns = sql`a.name AS author_name, a.slug AS author_slug`
const authorJoin = (alias: 'r' | 'q') =>
  sql`LEFT JOIN athletes a ON a.member_id = ${sql.raw(alias)}.member_id AND a.moderation_state = 'approved' AND a.visibility_profile = 'public'`

type AuthorRow = { author_name: string | null; author_slug: string | null }
const authorOf = (row: AuthorRow): PublicAuthor =>
  row.author_name && row.author_slug ? { name: row.author_name, path: `/athletes/${row.author_slug}` } : { name: 'ERC member', path: null }

const at = (value: Date | string) => new Date(value).toISOString() as Instant

async function ratingSummaries(payload: Payload, keys: readonly string[]): Promise<Map<string, RatingSummary>> {
  if (keys.length === 0) return new Map()
  const rows = await rowsOf<{ subject_key: string; n: number; average: number }>(
    payload,
    sql`
      SELECT subject_key, count(*)::int AS n, round(avg(rating), 1)::float AS average
      FROM reviews WHERE moderation_state = 'approved' AND subject_key IN (${sql.join(keys.map((key) => sql`${key}`), sql`, `)})
      GROUP BY subject_key`,
  )
  return new Map(rows.map((row) => [row.subject_key, { count: row.n, average: row.average }]))
}

const keyOfShoe = (id: number) => subjectKeyOf({ kind: 'shoes', id: id as Id<'shoes'> })

const shoeOf = (doc: ShoeDoc, ratings: Map<string, RatingSummary>): PublicShoe => {
  const url = mediaUrl(doc.image)
  return {
    id: doc.id as Id<'shoes'>,
    slug: doc.slug as Slug,
    brand: doc.brand,
    model: doc.model,
    category: doc.category,
    description: doc.description,
    image: url && typeof doc.image === 'object' && doc.image ? { url, alt: doc.image.alt ?? `${doc.brand} ${doc.model}` } : null,
    rating: ratings.get(keyOfShoe(doc.id)) ?? NO_RATINGS,
  }
}

async function readShoes(category: ShoeCategory | null): Promise<PublicShoe[]> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'shoes',
    overrideAccess: false,
    depth: 1,
    pagination: false,
    sort: ['brand', 'model'],
    ...(category ? { where: { category: { equals: category } } } : {}),
  })
  const ratings = await ratingSummaries(payload, docs.map((doc) => keyOfShoe(doc.id)))
  return docs.map((doc) => shoeOf(doc, ratings))
}

const cachedShoes = cached(readShoes, 'shoes:list', ['shoes', 'reviews', 'media'])

/** Every listed shoe in brand order, with its approved ratings; one category when asked. */
export const getShoes = (category: ShoeCategory | null) => cachedShoes(category)

async function readShoe(slug: string): Promise<PublicShoe | null> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'shoes', overrideAccess: false, depth: 1, limit: 1, pagination: false, where: { slug: { equals: slug } } })
  const doc = docs[0]
  return doc ? shoeOf(doc, await ratingSummaries(payload, [keyOfShoe(doc.id)])) : null
}

export const getShoe = cached(readShoe, 'shoes:get', ['shoes', 'reviews', 'media'])

type ReviewRow = AuthorRow & { id: number; rating: number; title: string; body: string; km_run: number | null; year_run: number | null; created_at: Date | string }

async function readReviews(key: string): Promise<{ reviews: PublicReview[]; rating: RatingSummary }> {
  const payload = await getPayload({ config })
  const rows = await rowsOf<ReviewRow>(
    payload,
    sql`
      SELECT r.id, r.rating::int AS rating, r.title, r.body, r.km_run::int AS km_run, r.year_run::int AS year_run, r.created_at, ${authorColumns}
      FROM reviews r ${authorJoin('r')}
      WHERE r.subject_key = ${key} AND r.moderation_state = 'approved'
      ORDER BY r.created_at DESC`,
  )
  const reviews = rows.map((row) => ({
    id: row.id,
    author: authorOf(row),
    rating: row.rating as Rating,
    title: row.title,
    body: row.body,
    kmRun: row.km_run,
    yearRun: row.year_run,
    at: at(row.created_at),
  }))
  return { reviews, rating: (await ratingSummaries(payload, [key])).get(key) ?? NO_RATINGS }
}

const cachedReviews = cached(readReviews, 'reviews:of', ['reviews', 'athletes'])

/** Approved reviews of one shoe or race, newest first, with their average. */
export const getReviews = (subject: ReviewSubject) => cachedReviews(subjectKeyOf(subject))

type QuestionRow = AuthorRow & {
  id: number
  text: string
  answer: string | null
  answered_at: Date | string | null
  created_at: Date | string
  coach_name: string | null
  coach_slug: string | null
}

async function readQuestions(race: number): Promise<PublicQuestion[]> {
  const payload = await getPayload({ config })
  const rows = await rowsOf<QuestionRow>(
    payload,
    sql`
      SELECT q.id, q.text, q.answer, q.answered_at, q.created_at, c.name AS coach_name, c.slug AS coach_slug, ${authorColumns}
      FROM questions q ${authorJoin('q')}
      LEFT JOIN questions_rels rel ON rel.parent_id = q.id AND rel.path = 'answeredBy'
      LEFT JOIN coaches c ON c.id = rel.coaches_id AND c._status = 'published'
      WHERE q.race_id = ${race} AND q.moderation_state = 'approved'
      ORDER BY q.created_at DESC`,
  )
  return rows.map((row) => ({
    id: row.id,
    author: authorOf(row),
    text: row.text,
    // An answer from staff, or from a coach whose profile is not published, is the club's.
    answer: row.answer
      ? { text: row.answer, by: row.coach_name && row.coach_slug ? { name: row.coach_name, path: `/coaches/${row.coach_slug}` } : null, at: row.answered_at ? at(row.answered_at) : null }
      : null,
    at: at(row.created_at),
  }))
}

/** Approved questions about one race, newest first, each with its answer if it has one. */
export const getQuestions = cached(readQuestions, 'questions:of', ['questions', 'athletes', 'coaches'])
