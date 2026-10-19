/**
 * Checks `queryRaces` against an independent in-memory filter over every race in the database:
 * `pnpm payload run src/scripts/check-race-calendar.ts`. Run it after seeding.
 */
import config from '@payload-config'
import {
  DISCIPLINES,
  DISTANCE_BANDS,
  INDIAN_SUBDIVISIONS,
  parseRaceQuery,
  type Discipline,
  type DistanceBand,
  type LocalDate,
  type QueryParams,
  type RaceQuery,
  type Subdivision,
} from '@erc/domain'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { getPayload } from 'payload'

import { parseRaceDoc, queryRaces, raceBySlug, RACES_PER_PAGE } from '@/content/races'

const payload = await getPayload({ config })
const db = payload.db.drizzle
const today = '2026-10-19' as LocalDate
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(wanted)}`}`)
  if (!ok) failures.push(label)
}

type Row = {
  id: number
  discipline: string
  start: string
  kind: 'venue' | 'virtual'
  subdivision: string | null
  status: string
  closes_on: string | null
  name: string
  city: string | null
  approved: boolean
  bands: string[]
}

const { rows } = await db.execute(sql`
  SELECT r.id, r.discipline, r.dates_start AS start, r.location_kind AS kind, r.location_subdivision AS subdivision,
    r.status_kind AS status, r.registration_closes_on AS closes_on, r.name, r.location_city AS city,
    r.moderation_state = 'approved' AS approved,
    coalesce(array_agg(d.band::text) FILTER (WHERE d.band IS NOT NULL), '{}') AS bands
  FROM races r LEFT JOIN races_distances d ON d._parent_id = r.id
  GROUP BY r.id`)
const races = rows as Row[]

const matches = (race: Row, q: RaceQuery) => {
  const text = q.text?.toLowerCase()
  const virtualWanted = q.includeVirtual || q.disciplines.includes('virtual')
  return (
    race.approved &&
    race.start >= q.from &&
    (!q.to || race.start <= q.to) &&
    (q.disciplines.length === 0 || q.disciplines.includes(race.discipline as never)) &&
    (q.bands.length === 0 || race.bands.some((band) => q.bands.includes(band as never))) &&
    (race.kind === 'virtual' ? virtualWanted : !q.subdivision || race.subdivision === q.subdivision) &&
    (!q.registrationOpen || (race.status !== 'cancelled' && (race.closes_on === null || race.closes_on >= today))) &&
    (!text || race.name.toLowerCase().includes(text) || (race.city ?? '').toLowerCase().includes(text))
  )
}

const resultCount = (q: RaceQuery) => races.filter((race) => matches(race, q)).length

// Written apart from `tapChip` on purpose: this is what tapping a chip means, stated a second time.
const withOrWithout = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
const tappingDiscipline = (q: RaceQuery, value: Discipline): RaceQuery => ({ ...q, page: 1, disciplines: withOrWithout(q.disciplines, value) })
const tappingBand = (q: RaceQuery, value: DistanceBand): RaceQuery => ({ ...q, page: 1, bands: withOrWithout(q.bands, value) })
const tappingState = (q: RaceQuery, value: Subdivision): RaceQuery => ({ ...q, page: 1, subdivision: q.subdivision === value ? null : value })

const cases: [string, QueryParams][] = [
  ['default upcoming list', {}],
  ['page 3', { page: '3' }],
  ['one state', { state: 'IN-TS' }],
  ['one discipline', { discipline: 'trail' }],
  ['two disciplines', { discipline: 'trail,road' }],
  ['virtual discipline', { discipline: 'virtual' }],
  ['virtual discipline beside road', { discipline: 'road,virtual' }],
  ['virtual included', { virtual: '1' }],
  ['state with virtual included', { state: 'IN-TS', virtual: '1' }],
  ['band plus state', { band: 'half-to-marathon', state: 'IN-AP' }],
  ['two bands', { band: 'under-10k,over-100k' }],
  ['one of every family', { discipline: 'road', band: 'under-10k', state: 'IN-TS', virtual: '1' }],
  ['city text', { q: 'hyderabad' }],
  ['text with a LIKE wildcard', { q: '50%' }],
  ['registration open', { open: '1' }],
  ['date window', { from: '2026-12-01', to: '2027-01-31' }],
  ['past start', { from: '2026-06-01' }],
  ['everything at once', { discipline: 'trail,mountain', band: 'marathon-to-60k', state: 'IN-TS', virtual: '1', open: '1', q: 'ultra', page: '1' }],
]

for (const [name, params] of cases) {
  const query = parseRaceQuery(params, today)
  const page = await queryRaces(payload, query, today)
  const expected = races.filter((race) => matches(race, query)).sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id)
  const offset = (query.page - 1) * RACES_PER_PAGE

  expect(`${name}: page ids`, page.races.map((race) => race.id), expected.slice(offset, offset + RACES_PER_PAGE).map((race) => race.id))
  expect(`${name}: total`, page.total, expected.length)
  expect(`${name}: total pages`, page.totalPages, Math.max(1, Math.ceil(expected.length / RACES_PER_PAGE)))

  const chips = [
    ...DISCIPLINES.map((value) => [`discipline ${value}`, page.facets.disciplines[value], tappingDiscipline(query, value)] as const),
    ...DISTANCE_BANDS.map(({ key }) => [`band ${key}`, page.facets.bands[key], tappingBand(query, key)] as const),
    ...page.facets.subdivisions.map(({ subdivision, count }) => [`state ${subdivision}`, count, tappingState(query, subdivision)] as const),
  ]
  const wrong: string[] = []
  for (const [chip, count, tapped] of chips) {
    const shown = (await queryRaces(payload, tapped, today)).total
    if (count !== resultCount(tapped) || count !== shown) wrong.push(`${chip} shows ${count}, tapping it gives ${resultCount(tapped)} (page total ${shown})`)
  }
  expect(`${name}: every chip's count is the result count after tapping it`, wrong, [])

  const listedStates = page.facets.subdivisions.map((entry) => entry.subdivision).sort()
  const statesWithVenues = INDIAN_SUBDIVISIONS.map(({ code }) => code).filter(
    (code) => code === query.subdivision || races.some((race) => race.kind === 'venue' && race.subdivision === code && matches(race, tappingState(query, code))),
  )
  expect(`${name}: listed states are those with venue races, plus the selected one`, listedStates, statesWithVenues.sort())
}

const approved = await payload.find({ collection: 'races', where: { 'moderation.state': { equals: 'approved' } }, pagination: false, depth: 0 })
const unparsed = approved.docs.filter((doc) => !parseRaceDoc(doc).ok)
expect('every approved race parses', unparsed.map((doc) => doc.slug), [])

const submitted = races.find((race) => !race.approved)
const submittedSlug = submitted && (await payload.findByID({ collection: 'races', id: submitted.id, depth: 0 })).slug
expect('an unapproved race is not readable by slug', submittedSlug ? await raceBySlug(payload, submittedSlug) : 'no unapproved race', null)

const victim = approved.docs[0]
if (victim) {
  await db.execute(sql`UPDATE races SET last_verified_on = 'not-a-date' WHERE id = ${victim.id}`)
  try {
    expect('a race that fails to parse is skipped, not thrown', await raceBySlug(payload, victim.slug), null)
  } finally {
    await db.execute(sql`UPDATE races SET last_verified_on = ${victim.lastVerifiedOn} WHERE id = ${victim.id}`)
  }
  expect('the restored race reads again', (await raceBySlug(payload, victim.slug))?.slug, victim.slug)

  const headerBreaking = `${victim.slug}"\r\nx: y`
  await db.execute(sql`UPDATE races SET slug = ${headerBreaking} WHERE id = ${victim.id}`)
  try {
    expect('a race whose slug would break a filename header is skipped', await raceBySlug(payload, headerBreaking), null)
  } finally {
    await db.execute(sql`UPDATE races SET slug = ${victim.slug} WHERE id = ${victim.id}`)
  }
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`All race calendar checks passed over ${races.length} races`)
process.exit(0)
