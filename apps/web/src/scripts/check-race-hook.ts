/**
 * Proves the races hook runs @erc/domain inside Payload: `pnpm payload run src/scripts/check-race-hook.ts`.
 * Everything it writes is removed.
 */
import config from '@payload-config'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

const payload = await getPayload({ config })
const run = Date.now()
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const raceData = (slug: string, start: string, dayCount: number): RequiredDataFromCollectionSlug<'races'> => ({
  name: slug,
  slug,
  discipline: 'trail',
  dates: { start, dayCount },
  timeZone: 'Asia/Kolkata',
  location: { kind: 'venue', venue: 'Gandipet Lake', city: 'Hyderabad', subdivision: 'IN-TS', country: 'IN' },
  distances: [{ metres: 5000 }, { metres: 25000 }, { metres: 160934 }],
  officialUrl: 'https://example.org/race',
  registration: { url: 'https://example.org/register' },
  status: { kind: 'scheduled' },
  source: { kind: 'runner-submission' },
  lastVerifiedOn: '2026-10-19',
  summary: 'Hook check',
  moderation: { state: 'submitted' },
})

const keysOf = async (id: number) => {
  const race = await payload.findByID({ collection: 'races', id })
  return race.distances?.map(({ metres, category, band }) => ({ metres, category, band }))
}

const created: number[] = []
try {
  const single = await payload.create({ collection: 'races', data: raceData(`hook-check-single-${run}`, '2026-12-06', 1) })
  created.push(single.id)
  expect('single-day race derives category and band from metres', await keysOf(single.id), [
    { metres: 5000, category: '5k', band: 'under-10k' },
    { metres: 25000, category: 'other', band: 'half-to-marathon' },
    { metres: 160934, category: 'ultra-100mi', band: 'over-100k' },
  ])

  const multi = await payload.create({ collection: 'races', data: raceData(`hook-check-multi-${run}`, '2026-12-06', 3) })
  created.push(multi.id)
  expect('multi-day race is categorised as a multi-day ultra, band unchanged', await keysOf(multi.id), [
    { metres: 5000, category: 'ultra-multiday', band: 'under-10k' },
    { metres: 25000, category: 'ultra-multiday', band: 'half-to-marathon' },
    { metres: 160934, category: 'ultra-multiday', band: 'over-100k' },
  ])

  await payload.update({ collection: 'races', id: multi.id, data: { dates: { start: '2026-12-06', dayCount: 1 } } })
  expect('changing only the day count re-derives the categories', (await keysOf(multi.id))?.map((d) => d.category), [
    '5k',
    'other',
    'ultra-100mi',
  ])

  const invalid = await payload
    .create({ collection: 'races', data: raceData(`hook-check-invalid-${run}`, '2026-02-30', 1) })
    .then(
      (race) => {
        created.push(race.id)
        return 'accepted'
      },
      (error: { status?: number; data?: { errors?: { path: string }[] } }) => ({
        status: error.status,
        paths: error.data?.errors?.map((e) => e.path),
      }),
    )
  expect('an impossible start date is rejected', invalid, { status: 400, paths: ['dates.start'] })
} finally {
  if (created.length > 0) await payload.delete({ collection: 'races', where: { id: { in: created } } })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All race hook checks passed')
process.exit(0)
