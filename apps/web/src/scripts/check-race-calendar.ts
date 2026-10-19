/**
 * Checks `queryRaces` against an independent in-memory filter over every race in the database:
 * `pnpm payload run src/scripts/check-race-calendar.ts`. Run it after seeding.
 */
import config from '@payload-config'
import { parseRaceQuery, type LocalDate, type QueryParams, type RaceQuery } from '@erc/domain'
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

type Family = 'discipline' | 'band' | 'subdivision'

const matches = (race: Row, q: RaceQuery, omit?: Family) => {
  const text = q.text?.toLowerCase()
  const virtualWanted = q.includeVirtual || (omit === 'discipline' ? race.discipline === 'virtual' : q.disciplines.includes('virtual'))
  const placeOk =
    race.kind === 'virtual' ? virtualWanted : omit === 'subdivision' || !q.subdivision || race.subdivision === q.subdivision
  return (
    race.approved &&
    race.start >= q.from &&
    (!q.to || race.start <= q.to) &&
    (omit === 'discipline' || q.disciplines.length === 0 || q.disciplines.includes(race.discipline as never)) &&
    (omit === 'band' || q.bands.length === 0 || race.bands.some((band) => q.bands.includes(band as never))) &&
    placeOk &&
    (!q.registrationOpen || (race.status !== 'cancelled' && (race.closes_on === null || race.closes_on >= today))) &&
    (!text || race.name.toLowerCase().includes(text) || (race.city ?? '').toLowerCase().includes(text))
  )
}

const countBy = (items: Row[], keys: (race: Row) => readonly string[]) => {
  const counts: Record<string, number> = {}
  for (const race of items) for (const key of new Set(keys(race))) counts[key] = (counts[key] ?? 0) + 1
  return counts
}

const sorted = (record: Readonly<Record<string, number | undefined>>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))

const cases: [string, QueryParams][] = [
  ['default upcoming list', {}],
  ['page 3', { page: '3' }],
  ['one state', { state: 'IN-TS' }],
  ['one discipline', { discipline: 'trail' }],
  ['two disciplines', { discipline: 'trail,road' }],
  ['virtual discipline', { discipline: 'virtual' }],
  ['virtual included', { virtual: '1' }],
  ['band plus state', { band: 'half-to-marathon', state: 'IN-AP' }],
  ['two bands', { band: 'under-10k,over-100k' }],
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
  expect(`${name}: total pages`, page.totalPages, Math.max(1, Math.ceil(expected.length / RACES_PER_PAGE)))
  expect(
    `${name}: discipline counts`,
    sorted(page.facets.disciplines),
    sorted(countBy(races.filter((race) => matches(race, query, 'discipline')), (race) => [race.discipline])),
  )
  expect(`${name}: band counts`, sorted(page.facets.bands), sorted(countBy(races.filter((race) => matches(race, query, 'band')), (race) => race.bands)))
  expect(
    `${name}: state counts`,
    sorted(Object.fromEntries(page.facets.subdivisions.map(({ subdivision, count }) => [subdivision, count]))),
    sorted(
      countBy(
        races.filter((race) => race.kind === 'venue' && matches(race, query, 'subdivision')),
        (race) => (race.subdivision ? [race.subdivision] : []),
      ),
    ),
  )
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
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`All race calendar checks passed over ${races.length} races`)
process.exit(0)
