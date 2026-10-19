import config from '@payload-config'
import {
  canonicalPathOf,
  DISCIPLINES,
  DISTANCE_BANDS,
  INDIAN_SUBDIVISIONS,
  parseLocalDate,
  parseSlug,
  tapChip,
  type FacetChip,
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

const uncachedFindRaces = async (query: RaceQuery, today: LocalDate) => queryRaces(await getPayload({ config }), query, today)
const cachedFindRaces = cacheRaceReads(uncachedFindRaces, 'races:find')

/**
 * Only views with at most one value per chip family are cached, and none with text or custom dates. The on-disk cache
 * is never evicted and `today` is in the key, so this set bounds what each IST day adds: 9 discipline choices (one of
 * 8, or none) times 7 band choices (one of 6, or none) times 37 state choices (one of 36, or none) times 2 for virtual
 * times 2 for registration open, 9,324 views, each cached once per page it has. Caching every combination would allow
 * 2^8 times 2^6 times 37 times 4, about 2.4 million views a day. The rest read uncached and return the same page.
 */
const isCacheable = (query: RaceQuery, today: LocalDate) =>
  query.text === null && query.to === null && query.from === today && query.disciplines.length <= 1 && query.bands.length <= 1

/**
 * Approved races matching the query, 24 per page in start-date order, with facet counts. A page past the end gives
 * the last page instead, so `page` in the result can be lower than asked for. `today` is read here, outside the
 * cache, so the cache key changes at midnight IST and "upcoming" needs no scheduled refresh.
 */
export const findRaces = async (query: RaceQuery): Promise<RacePage> => {
  const today = todayIn('Asia/Kolkata')
  const read = isCacheable(query, today) ? cachedFindRaces : uncachedFindRaces
  // Page 1 is read first so a page number past the end never becomes a cache key.
  const first = await read({ ...query, page: 1 }, today)
  const page = Math.min(query.page, first.totalPages)
  return page === 1 ? first : read({ ...query, page }, today)
}

const approvedSlugs = cacheRaceReads(async (): Promise<string[]> => {
  const { rows } = await (await getPayload({ config })).db.drizzle.execute(sql`SELECT slug FROM races WHERE moderation_state = 'approved'`)
  return rows.map((row) => String(row.slug))
}, 'races:slugs')

const cachedRaceBySlug = cacheRaceReads(async (slug: string) => raceBySlug(await getPayload({ config }), slug), 'races:get')

/**
 * An approved race by slug; null for unknown, unapproved, or unparseable races. Unknown slugs are answered from the
 * cached slug list, so a made-up URL adds no cache entry and no query. `cache` shares one lookup between a page and
 * its metadata, which `unstable_cache` alone does not do for concurrent misses.
 */
export const getRace = cache(async (slug: string): Promise<PublicRace | null> =>
  (await approvedSlugs()).includes(slug) ? cachedRaceBySlug(slug) : null,
)

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

  /** One statement per chip family: each chip's count is a FILTER over the query its link leads to. */
  const chipCounts = async <K extends string>(chips: readonly (readonly [K, SQL])[]) => {
    const columns = chips.map(([key, where]) => sql`count(*) FILTER (WHERE ${where}) AS ${sql.identifier(key)}`)
    const [row] = await rows<Record<K, string>>(sql`SELECT ${sql.join(columns, sql`, `)} FROM races r WHERE ${shared(query, today)}`)
    return (key: K) => Number(row?.[key] ?? 0)
  }
  const tapped = (chip: FacetChip) => narrowing(tapChip(query, chip))

  const [ids, [total], disciplineCount, bandCount, stateCount] = await Promise.all([
    rows<{ id: number }>(sql`
      SELECT r.id FROM races r WHERE ${filters(query, today)}
      ORDER BY r.dates_start, r.id
      LIMIT ${RACES_PER_PAGE} OFFSET ${(query.page - 1) * RACES_PER_PAGE}`),
    rows<{ count: string }>(sql`SELECT count(*) AS count FROM races r WHERE ${filters(query, today)}`),
    chipCounts(DISCIPLINES.map((value) => [value, tapped({ family: 'discipline', value })] as const)),
    chipCounts(BAND_KEYS.map((value) => [value, tapped({ family: 'band', value })] as const)),
    chipCounts(
      SUBDIVISION_CODES.flatMap((value) => {
        const where = tapped({ family: 'subdivision', value })
        return [
          [value, where],
          [`venue:${value}`, sql`${where} AND r.location_kind = 'venue'`],
        ] as const
      }),
    ),
  ])

  const facets: RaceFacets = {
    disciplines: Object.fromEntries(DISCIPLINES.map((key) => [key, disciplineCount(key)])) as Record<Discipline, number>,
    bands: Object.fromEntries(BAND_KEYS.map((key) => [key, bandCount(key)])) as Record<DistanceBand, number>,
    // With virtual races included every state's count includes them, so whether a state is listed depends on venues alone.
    subdivisions: SUBDIVISION_CODES.filter((code) => code === query.subdivision || stateCount(`venue:${code}`) > 0)
      .map((subdivision) => ({ subdivision, count: stateCount(subdivision) }))
      .sort((a, b) => b.count - a.count || a.subdivision.localeCompare(b.subdivision)),
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

const BAND_KEYS = DISTANCE_BANDS.map((band) => band.key)
const SUBDIVISION_CODES = INDIAN_SUBDIVISIONS.map((subdivision) => subdivision.code)

const inList = (column: SQL, values: readonly string[]) =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/**
 * Clauses no chip changes. Visibility is enforced here as well as by Payload's read access, because raw SQL bypasses
 * access control.
 */
function shared(query: RaceQuery, today: LocalDate): SQL {
  const clauses: SQL[] = [sql`r.moderation_state = 'approved'`, sql`r.dates_start >= ${query.from}`]
  if (query.to) clauses.push(sql`r.dates_start <= ${query.to}`)
  if (query.registrationOpen) {
    clauses.push(sql`r.status_kind <> 'cancelled' AND (r.registration_closes_on IS NULL OR r.registration_closes_on >= ${today})`)
  }
  if (query.text) {
    const pattern = `%${escapeLike(query.text)}%`
    clauses.push(sql`(r.name ILIKE ${pattern} OR r.location_city ILIKE ${pattern})`)
  }
  return sql.join(clauses, sql` AND `)
}

/** Clauses a chip can change. Place belongs here because choosing the virtual discipline is asking for virtual races. */
function narrowing(query: RaceQuery): SQL {
  const clauses: SQL[] = []
  if (query.disciplines.length > 0) clauses.push(inList(sql`r.discipline`, query.disciplines))
  if (query.bands.length > 0) {
    clauses.push(sql`EXISTS (SELECT 1 FROM races_distances d WHERE d._parent_id = r.id AND ${inList(sql`d.band`, query.bands)})`)
  }
  const venue = query.subdivision
    ? sql`(r.location_kind = 'venue' AND r.location_subdivision = ${query.subdivision})`
    : sql`r.location_kind = 'venue'`
  const virtualIncluded = query.includeVirtual || query.disciplines.includes('virtual')
  clauses.push(sql`(${venue} OR (r.location_kind = 'virtual' AND ${virtualIncluded}))`)
  return sql.join(clauses, sql` AND `)
}

const filters = (query: RaceQuery, today: LocalDate): SQL => sql`${shared(query, today)} AND ${narrowing(query)}`

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

const slugOf = (value: string): Slug => {
  const parsed = parseSlug(value)
  return parsed.ok ? parsed.value : fail('slug')
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
        slug: slugOf(doc.slug),
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
