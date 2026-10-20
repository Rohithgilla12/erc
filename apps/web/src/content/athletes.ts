import config from '@payload-config'
import {
  athleteRecordOf,
  headlineBests,
  parseLocalDate,
  parseSlug,
  type Athlete,
  type AthleteRecord,
  type HeadlineBest,
  type HttpsUrl,
  type Id,
  type Instant,
  type LocalDate,
  type Metres,
  type RaceResult,
  type Result,
  type Seconds,
  type Slug,
  type StaffId,
} from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { Athlete as AthleteDoc, Result as ResultDoc } from '@/payload-types'
import { siteConfig } from '@/site-config'

/** A public athlete with the bests a directory card shows; empty while the athlete keeps results hidden. */
export type DirectoryEntry = { athlete: Athlete; headline: readonly HeadlineBest[] }

/** Approved races a listed result links to, by id. Results whose race is not public link nowhere. */
export type RaceSlugs = Readonly<Record<number, Slug>>

export type AthleteProfile = { athlete: Athlete; record: AthleteRecord; raceSlugs: RaceSlugs }

// Results link to races only while a race is approved, and avatars come from `media`, so edits to either expire these reads.
const cacheAthleteReads = <A extends unknown[], R>(read: (...args: A) => Promise<R>, key: string) =>
  unstable_cache(read, [key], {
    tags: [collectionTag('athletes'), collectionTag('results'), collectionTag('races'), collectionTag('media')],
    revalidate: 3600,
  })

/** Every athlete with a public profile, by name, with headline bests. One cached read serves every state filter. */
export const listAthletes = cacheAthleteReads(async () => athleteDirectory(await getPayload({ config })), 'athletes:directory')

const cachedProfile = cacheAthleteReads(async (slug: string) => athleteProfile(await getPayload({ config }), slug), 'athletes:profile')

/**
 * A public athlete by slug, or null. Unknown and hidden slugs are answered from the cached directory, so a made-up URL
 * adds no cache entry. `cache` shares one lookup between a page and its metadata.
 */
export const getAthleteProfile = cache(async (slug: string): Promise<AthleteProfile | null> =>
  (await listAthletes()).some((entry) => entry.athlete.slug === slug) ? cachedProfile(slug) : null,
)

/**
 * Uncached; pages call `listAthletes`. Every read is anonymous (`overrideAccess: false`), so the collections' read
 * access decides what is public, exactly as it does for REST.
 */
export async function athleteDirectory(payload: Payload): Promise<DirectoryEntry[]> {
  const athletes = await publicAthletes(payload)
  const results = await publicResults(payload, athletes)
  return athletes.map((athlete) => {
    const record = athleteRecordOf(athlete, results)
    return { athlete, headline: record.visibility === 'public' ? headlineBests(record.achievements) : [] }
  })
}

/** Uncached; pages call `getAthleteProfile`. */
export async function athleteProfile(payload: Payload, slug: string): Promise<AthleteProfile | null> {
  const [athlete] = await publicAthletes(payload, slug)
  if (!athlete) return null
  const record = athleteRecordOf(athlete, await publicResults(payload, [athlete]))
  return { athlete, record, raceSlugs: record.visibility === 'public' ? await approvedRaceSlugs(payload, record.results) : {} }
}

async function publicAthletes(payload: Payload, slug?: string): Promise<Athlete[]> {
  const { docs } = await payload.find({
    collection: 'athletes',
    overrideAccess: false,
    ...(slug === undefined ? {} : { where: { slug: { equals: slug } } }),
    depth: 1,
    sort: 'name',
    pagination: false,
  })
  return parsedOrLogged(docs, parseAthleteDoc, payload, 'athlete')
}

/** Only athletes who show results are asked about, so a hidden record is never read, let alone returned. */
async function publicResults(payload: Payload, athletes: readonly Athlete[]): Promise<RaceResult[]> {
  const showing = athletes.filter((athlete) => athlete.visibility.results === 'public').map((athlete) => athlete.id)
  if (showing.length === 0) return []
  const { docs } = await payload.find({
    collection: 'results',
    overrideAccess: false,
    where: { athlete: { in: showing } },
    depth: 0,
    pagination: false,
  })
  return parsedOrLogged(docs, parseResultDoc, payload, 'result')
}

async function approvedRaceSlugs(payload: Payload, results: readonly RaceResult[]): Promise<RaceSlugs> {
  const ids = [...new Set(results.flatMap((result) => (result.race === null ? [] : [result.race])))]
  if (ids.length === 0) return {}
  const { docs } = await payload.find({
    collection: 'races',
    overrideAccess: false,
    where: { id: { in: ids } },
    depth: 0,
    pagination: false,
    select: { slug: true },
  })
  return Object.fromEntries(
    docs.flatMap((race) => {
      const slug = parseSlug(race.slug)
      return slug.ok ? [[race.id, slug.value]] : []
    }),
  )
}

const parsedOrLogged = <D extends { id: number }, T>(
  docs: readonly D[],
  parse: (doc: D) => Result<T, string>,
  payload: Payload,
  kind: string,
): T[] =>
  docs.flatMap((doc) => {
    const parsed = parse(doc)
    if (parsed.ok) return [parsed.value]
    payload.logger.error({ [kind]: doc.id, field: parsed.error }, `Skipping a ${kind} that does not parse`)
    return []
  })

class InvalidField extends Error {}

const fail = (field: string): never => {
  throw new InvalidField(field)
}

const parsing = <T,>(read: () => T): Result<T, string> => {
  try {
    return { ok: true, value: read() }
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, error: error.message }
    throw error
  }
}

const idOf = (value: number | { id: number } | null | undefined, field: string): number =>
  typeof value === 'number' ? value : (value ?? fail(field)).id

/**
 * Same-origin media is accepted as well as https, because local uploads are served by the site itself; in every
 * deployed environment the site URL is https and R2 media is https.
 */
const photoUrlOf = (photo: AthleteDoc['photo']): HttpsUrl | null => {
  const raw = typeof photo === 'object' && photo !== null ? photo.url : null
  if (!raw) return null
  const { siteUrl } = siteConfig()
  const url = new URL(raw, siteUrl)
  return url.protocol === 'https:' || url.origin === siteUrl.origin ? (url.href as HttpsUrl) : null
}

/** Only an approved athlete with a public profile parses, whatever the query that found it asked for. */
export const parseAthleteDoc = (doc: AthleteDoc): Result<Athlete, string> =>
  parsing(() => {
    if (doc.moderation.state !== 'approved') fail('moderation.state')
    if (doc.visibility.profile !== 'public') fail('visibility.profile')
    const slug = parseSlug(doc.slug)
    return {
      id: doc.id as Id<'athletes'>,
      slug: slug.ok ? slug.value : fail('slug'),
      name: doc.name.trim() || fail('name'),
      photoUrl: photoUrlOf(doc.photo),
      bio: doc.bio?.trim() ?? '',
      home: { city: doc.home.city?.trim() || null, subdivision: doc.home.subdivision },
      runningSince: doc.runningSince ?? null,
      member: null,
      visibility: { profile: 'public', results: doc.visibility.results },
    }
  })

const localDate = (value: string, field: string): LocalDate => {
  const parsed = parseLocalDate(value)
  return parsed.ok ? parsed.value : fail(field)
}

const httpsUrlOrNull = (value: string | null | undefined, field: string): HttpsUrl | null => {
  if (!value) return null
  try {
    if (new URL(value).protocol === 'https:') return value as HttpsUrl
  } catch {
    // An unparseable URL fails the same way as a non-https one.
  }
  return fail(field)
}

export const parseResultDoc = (doc: ResultDoc): Result<RaceResult, string> =>
  parsing(() => {
    if (doc.moderation.state !== 'approved') fail('moderation.state')
    return {
      id: doc.id as Id<'results'>,
      athlete: idOf(doc.athlete, 'athlete') as Id<'athletes'>,
      race: doc.race == null ? null : (idOf(doc.race, 'race') as Id<'races'>),
      eventName: doc.eventName.trim() || fail('eventName'),
      date: localDate(doc.date, 'date'),
      distance: doc.distance > 0 ? (doc.distance as Metres) : fail('distance'),
      category: doc.category ?? fail('category'),
      time: Number.isInteger(doc.time) && doc.time > 0 ? (doc.time as Seconds) : fail('time'),
      provenance:
        doc.provenance.kind === 'official'
          ? { kind: 'official', timingUrl: httpsUrlOrNull(doc.provenance.timingUrl, 'provenance.timingUrl') }
          : { kind: 'self_reported', evidenceUrl: httpsUrlOrNull(doc.provenance.evidenceUrl, 'provenance.evidenceUrl') },
      moderation: {
        state: 'approved',
        by: idOf(doc.moderation.decidedBy, 'moderation.decidedBy') as StaffId,
        at: (doc.moderation.decidedAt ?? fail('moderation.decidedAt')) as Instant,
      },
    }
  })
