import config from '@payload-config'
import {
  canonicalPathOf,
  parseLocalDate,
  todayIn,
  type Discipline,
  type DistanceBand,
  type HttpsUrl,
  type Id,
  type Instant,
  type LocalDate,
  type Metres,
  type PublicRace,
  type RaceDistanceOption,
  type RaceFacets,
  type RacePage,
  type RaceQuery,
  type RaceSource,
  type Result,
  type Seconds,
  type Slug,
  type StaffId,
  type Subdivision,
} from '@erc/domain'
import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { Race as RaceDoc } from '@/payload-types'

export const RACES_PER_PAGE = 24

// The tag does the real work; the hour bounds staleness from writes that bypass Payload, such as hand-run SQL.
const cacheRaceReads = <A extends unknown[], R>(read: (...args: A) => Promise<R>, key: string) =>
  unstable_cache(read, [key], { tags: [collectionTag('races')], revalidate: 3600 })

const cachedFindRaces = cacheRaceReads(
  async (query: RaceQuery, today: LocalDate) => queryRaces(await getPayload({ config }), query, today),
  'races:find',
)

/**
 * Approved races matching the query, 24 per page in start-date order, with facet counts. `today` is read here,
 * outside the cache, so the cache key changes at midnight IST and "upcoming" needs no scheduled refresh.
 */
export const findRaces = (query: RaceQuery): Promise<RacePage> => cachedFindRaces(query, todayIn('Asia/Kolkata'))

/**
 * An approved race by slug; null for unknown, unapproved, or unparseable races. `cache` shares one lookup between
 * a page and its metadata, which `unstable_cache` alone does not do for concurrent misses.
 */
export const getRace = cache(cacheRaceReads(async (slug: string) => raceBySlug(await getPayload({ config }), slug), 'races:get'))

/** Uncached; pages call `getRace`. Exported for scripts that run outside Next.js. */
export async function raceBySlug(payload: Payload, slug: string): Promise<PublicRace | null> {
  const { docs } = await payload.find({
    collection: 'races',
    overrideAccess: false,
    where: { slug: { equals: slug } },
    depth: 0,
    limit: 1,
    pagination: false,
  })
  return publicRaces(docs, payload.logger)[0] ?? null
}

/** Uncached; pages call `findRaces`. Exported for scripts that run outside Next.js. */
export async function queryRaces(payload: Payload, query: RaceQuery, today: LocalDate): Promise<RacePage> {
  const db = payload.db.drizzle
  const rows = <T,>(statement: SQL) => db.execute(statement).then((result) => result.rows as T[])

  type Count<K> = { key: K; count: string }
  const [ids, [total], disciplines, bands, subdivisions] = await Promise.all([
    rows<{ id: number }>(sql`
      SELECT r.id FROM races r WHERE ${filters(query, today)}
      ORDER BY r.dates_start, r.id
      LIMIT ${RACES_PER_PAGE} OFFSET ${(query.page - 1) * RACES_PER_PAGE}`),
    rows<{ count: string }>(sql`SELECT count(*) AS count FROM races r WHERE ${filters(query, today)}`),
    rows<Count<Discipline>>(sql`
      SELECT r.discipline AS key, count(*) AS count FROM races r WHERE ${filters(query, today, 'discipline')}
      GROUP BY r.discipline`),
    rows<Count<DistanceBand>>(sql`
      SELECT d.band AS key, count(DISTINCT r.id) AS count
      FROM races r JOIN races_distances d ON d._parent_id = r.id
      WHERE ${filters(query, today, 'band')} AND d.band IS NOT NULL
      GROUP BY d.band`),
    rows<Count<Subdivision>>(sql`
      SELECT r.location_subdivision AS key, count(*) AS count FROM races r
      WHERE ${filters(query, today, 'subdivision')} AND r.location_kind = 'venue' AND r.location_subdivision IS NOT NULL
      GROUP BY r.location_subdivision ORDER BY count(*) DESC, r.location_subdivision`),
  ])

  const facets: RaceFacets = {
    disciplines: Object.fromEntries(disciplines.map(({ key, count }) => [key, Number(count)])),
    bands: Object.fromEntries(bands.map(({ key, count }) => [key, Number(count)])),
    subdivisions: subdivisions.map(({ key, count }) => ({ subdivision: key, count: Number(count) })),
  }
  return {
    races: await racesInOrder(
      ids.map((row) => row.id),
      payload,
    ),
    total: Number(total?.count ?? 0),
    page: query.page,
    totalPages: Math.max(1, Math.ceil(Number(total?.count ?? 0) / RACES_PER_PAGE)),
    facets,
    canonicalPath: canonicalPathOf(query, today),
  }
}

type Family = 'discipline' | 'band' | 'subdivision'

const inList = (column: SQL, values: readonly string[]) =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/**
 * The calendar's WHERE clause; `omit` drops one facet family's own filter for that family's counts. Visibility is
 * enforced here as well as by Payload's read access, because raw SQL bypasses access control.
 */
function filters(query: RaceQuery, today: LocalDate, omit?: Family): SQL {
  const clauses: SQL[] = [sql`r.moderation_state = 'approved'`, sql`r.dates_start >= ${query.from}`]
  if (query.to) clauses.push(sql`r.dates_start <= ${query.to}`)
  if (omit !== 'discipline' && query.disciplines.length > 0) clauses.push(inList(sql`r.discipline`, query.disciplines))
  if (omit !== 'band' && query.bands.length > 0) {
    clauses.push(sql`EXISTS (SELECT 1 FROM races_distances d WHERE d._parent_id = r.id AND ${inList(sql`d.band`, query.bands)})`)
  }

  const venue =
    omit !== 'subdivision' && query.subdivision
      ? sql`(r.location_kind = 'venue' AND r.location_subdivision = ${query.subdivision})`
      : sql`r.location_kind = 'venue'`
  // Choosing the virtual discipline is asking for virtual races. For discipline counts, decide per row, so the
  // virtual chip counts the races tapping it would show.
  const virtualIncluded =
    omit === 'discipline'
      ? sql`(${query.includeVirtual} OR r.discipline = 'virtual')`
      : sql`${query.includeVirtual || query.disciplines.includes('virtual')}`
  clauses.push(sql`(${venue} OR (r.location_kind = 'virtual' AND ${virtualIncluded}))`)

  if (query.registrationOpen) {
    clauses.push(sql`r.status_kind <> 'cancelled' AND (r.registration_closes_on IS NULL OR r.registration_closes_on >= ${today})`)
  }
  if (query.text) {
    const pattern = `%${escapeLike(query.text)}%`
    clauses.push(sql`(r.name ILIKE ${pattern} OR r.location_city ILIKE ${pattern})`)
  }
  return sql.join(clauses, sql` AND `)
}

async function racesInOrder(ids: readonly number[], payload: Payload): Promise<PublicRace[]> {
  if (ids.length === 0) return []
  const { docs } = await payload.find({
    collection: 'races',
    overrideAccess: false,
    where: { id: { in: ids } },
    depth: 0,
    limit: ids.length,
    pagination: false,
  })
  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  return publicRaces(
    ids.flatMap((id) => byId.get(id) ?? []),
    payload.logger,
  )
}

type Logger = { error: (details: object, message: string) => void }

const publicRaces = (docs: readonly RaceDoc[], logger: Logger): PublicRace[] =>
  docs.flatMap((doc) => {
    const parsed = parseRaceDoc(doc)
    if (parsed.ok) return [parsed.value]
    logger.error({ race: doc.id, slug: doc.slug, field: parsed.error }, 'Skipping a race that does not parse')
    return []
  })

class InvalidField extends Error {}

const fail = (field: string): never => {
  throw new InvalidField(field)
}

const present = <T,>(value: T | null | undefined, field: string): T => (value == null ? fail(field) : value)

const nonEmpty = (value: string | null | undefined, field: string): string => (value?.trim() ? value : fail(field))

const localDate = (value: string | null | undefined, field: string): LocalDate => {
  const parsed = parseLocalDate(value ?? '')
  return parsed.ok ? parsed.value : fail(field)
}

const httpsUrl = (value: string | null | undefined, field: string): HttpsUrl => {
  try {
    if (value && new URL(value).protocol === 'https:') return value as HttpsUrl
  } catch {
    // An unparseable URL fails the same way as a non-https one.
  }
  return fail(field)
}

const idOf = (value: number | { id: number } | null | undefined, field: string): number =>
  typeof value === 'number' ? value : present(value, field).id

const sourceOf = (source: RaceDoc['source']): RaceSource => {
  switch (source.kind) {
    case 'organiser':
      return { kind: 'organiser', url: httpsUrl(source.url, 'source.url') }
    case 'listing-site':
      return { kind: 'listing-site', name: nonEmpty(source.name, 'source.name'), url: httpsUrl(source.url, 'source.url') }
    case 'runner-submission':
      return { kind: 'runner-submission' }
    case 'coach-knowledge':
      return { kind: 'coach-knowledge', confirmedBy: idOf(source.confirmedBy, 'source.confirmedBy') as StaffId }
  }
}

const distanceOf = (option: RaceDoc['distances'][number], index: number): RaceDistanceOption => ({
  metres: option.metres as Metres,
  category: present(option.category, `distances.${index}.category`),
  band: present(option.band, `distances.${index}.band`),
  ...(option.elevationGainMetres == null ? {} : { elevationGainMetres: option.elevationGainMetres as Metres }),
  ...(option.terrain == null ? {} : { terrain: option.terrain }),
  ...(option.cutoff == null ? {} : { cutoff: option.cutoff as Seconds }),
})

/** The one mapping from a CMS document to the domain type. Anything unexpected names the field instead of throwing. */
export function parseRaceDoc(doc: RaceDoc): Result<PublicRace, string> {
  try {
    if (doc.moderation.state !== 'approved') fail('moderation.state')
    const [first, ...rest] = doc.distances.map(distanceOf)
    const dayCount = doc.dates.dayCount
    return {
      ok: true,
      value: {
        id: doc.id as Id<'races'>,
        slug: nonEmpty(doc.slug, 'slug') as Slug,
        name: nonEmpty(doc.name, 'name'),
        discipline: doc.discipline,
        dates: {
          start: localDate(doc.dates.start, 'dates.start'),
          dayCount: Number.isInteger(dayCount) && dayCount >= 1 ? dayCount : fail('dates.dayCount'),
        },
        timeZone: doc.timeZone,
        location:
          doc.location.kind === 'virtual'
            ? { kind: 'virtual' }
            : {
                kind: 'venue',
                venue: nonEmpty(doc.location.venue, 'location.venue'),
                city: nonEmpty(doc.location.city, 'location.city'),
                subdivision: present(doc.location.subdivision, 'location.subdivision'),
                country: doc.location.country ?? 'IN',
              },
        distances: [present(first, 'distances'), ...rest],
        officialUrl: httpsUrl(doc.officialUrl, 'officialUrl'),
        registration: {
          url: httpsUrl(doc.registration.url, 'registration.url'),
          closesOn: doc.registration.closesOn ? localDate(doc.registration.closesOn, 'registration.closesOn') : null,
        },
        status:
          doc.status.kind === 'postponed'
            ? { kind: 'postponed', newStart: doc.status.newStart ? localDate(doc.status.newStart, 'status.newStart') : null }
            : { kind: doc.status.kind },
        source: sourceOf(doc.source),
        lastVerifiedOn: localDate(doc.lastVerifiedOn, 'lastVerifiedOn'),
        summary: doc.summary,
        moderation: {
          state: 'approved',
          by: idOf(doc.moderation.decidedBy, 'moderation.decidedBy') as StaffId,
          at: present(doc.moderation.decidedAt, 'moderation.decidedAt') as Instant,
        },
      },
    }
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, error: error.message }
    throw error
  }
}
