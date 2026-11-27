/**
 * Upserts the real races in `fixtures/real-races.json` by slug and deletes the synthetic races from `seed-races.ts`:
 * `pnpm payload run src/scripts/seed-real-races.ts`. Each fixture race was checked against its `verifiedFrom` page on
 * `VERIFIED_ON`; re-check the page and bump that date rather than editing a race from memory. A re-run keeps each race's
 * status, and leaves alone a race staff verified after `VERIFIED_ON`.
 */
import { readFileSync } from 'node:fs'

import config from '@payload-config'
import type { Discipline, LocalDate, Subdivision } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

import { seedStaffAccount } from './staff-account'

type RaceData = RequiredDataFromCollectionSlug<'races'>
type Distance = NonNullable<RaceData['distances']>[number]

type RealRace = {
  name: string
  slug: string
  discipline: Discipline
  start: LocalDate
  dayCount: number
  venue: string
  city: string
  subdivision: Subdivision
  distances: Pick<Distance, 'metres' | 'terrain'>[]
  officialUrl: string
  registrationUrl: string
  registrationClosesOn: LocalDate | null
  verifiedFrom: string
  summary: string
} & (
  { sourceKind: 'organiser'; sourceName: null } | { sourceKind: 'listing-site'; sourceName: string }
)

const VERIFIED_ON = '2026-11-27' as LocalDate
/** `seed-races.ts` puts every synthetic race's official link on this domain. */
const SYNTHETIC_DOMAIN = '.example.in'

const fixture: RealRace[] = JSON.parse(
  readFileSync(new URL('./fixtures/real-races.json', import.meta.url), 'utf8'),
)

const toData = (race: RealRace): Omit<RaceData, 'status'> => ({
  name: race.name,
  slug: race.slug,
  discipline: race.discipline,
  dates: { start: race.start, dayCount: race.dayCount },
  timeZone: 'Asia/Kolkata',
  location: {
    kind: 'venue',
    venue: race.venue,
    city: race.city,
    subdivision: race.subdivision,
    country: 'IN',
  },
  distances: race.distances,
  officialUrl: race.officialUrl,
  registration: { url: race.registrationUrl, closesOn: race.registrationClosesOn },
  source:
    race.sourceKind === 'organiser'
      ? { kind: 'organiser', url: race.verifiedFrom }
      : { kind: 'listing-site', name: race.sourceName, url: race.verifiedFrom },
  lastVerifiedOn: VERIFIED_ON,
  summary: race.summary,
  moderation: { state: 'submitted' },
})

const payload = await getPayload({ config })

const user = await seedStaffAccount(payload, 'seed@erc.invalid', 'editor')
const context = { skipRevalidation: true }

const synthetic = { officialUrl: { like: SYNTHETIC_DOMAIN } }
const syntheticIds = (await payload.find({ collection: 'races', where: synthetic, depth: 0, pagination: false, select: { slug: true } })).docs.map((doc) => doc.id)
const linkedResults =
  syntheticIds.length > 0 ? (await payload.count({ collection: 'results', where: { race: { in: syntheticIds } } })).totalDocs : 0
console.log(`${linkedResults} results link to the ${syntheticIds.length} synthetic races about to be deleted`)
const removed = await payload.delete({ collection: 'races', where: synthetic, context })
if (removed.errors.length > 0) {
  for (const { id, message } of removed.errors) console.error(`Could not delete synthetic race ${id}: ${message}`)
  throw new Error(`${removed.errors.length} synthetic races were not deleted`)
}
console.log(`Removed ${removed.docs.length} synthetic races`)

let created = 0
let updated = 0
let newer = 0
for (const race of fixture) {
  const data = toData(race)
  const { docs } = await payload.find({
    collection: 'races',
    where: { slug: { equals: race.slug } },
    depth: 0,
    limit: 1,
    pagination: false,
  })
  const existing = docs[0]
  if (!existing) {
    await payload.create({
      collection: 'races',
      data: { ...data, status: { kind: 'scheduled' }, moderationDecision: 'approve' },
      context,
      user,
    })
    created++
    continue
  }
  // Staff re-checked this race after the fixture was verified, so what they saved is newer than the fixture.
  if (existing.lastVerifiedOn > VERIFIED_ON) {
    newer++
    continue
  }
  // Only a submitted race can be decided; a race staff rejected stays rejected. The status is left as staff set it, so
  // a re-run cannot bring back a cancelled race.
  const decision =
    existing.moderation?.state === 'submitted' ? { moderationDecision: 'approve' as const } : {}
  await payload.update({
    collection: 'races',
    id: existing.id,
    data: { ...data, ...decision },
    context,
    user,
  })
  updated++
}
console.log(`Created ${created} and updated ${updated} real races; left ${newer} that staff verified after ${VERIFIED_ON}`)
await refreshRunningSite(payload, [collectionTag('races')])
process.exit(0)
