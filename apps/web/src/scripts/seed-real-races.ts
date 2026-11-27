/**
 * Upserts the real races in `fixtures/real-races.json` by slug and deletes the synthetic races from `seed-races.ts`:
 * `pnpm payload run src/scripts/seed-real-races.ts`. Each fixture race was checked against its `verifiedFrom` page on
 * `VERIFIED_ON`; re-check the page and bump that date rather than editing a race from memory.
 */
import { readFileSync } from 'node:fs'

import config from '@payload-config'
import type { Discipline, LocalDate, Subdivision } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

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

const toData = (race: RealRace): RaceData => ({
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
  status: { kind: 'scheduled' },
  source:
    race.sourceKind === 'organiser'
      ? { kind: 'organiser', url: race.verifiedFrom }
      : { kind: 'listing-site', name: race.sourceName, url: race.verifiedFrom },
  lastVerifiedOn: VERIFIED_ON,
  summary: race.summary,
  moderation: { state: 'submitted' },
})

const payload = await getPayload({ config })

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({
  collection: 'staff',
  where: { email: { equals: seedEmail } },
  limit: 1,
})
const staff =
  existingStaff.docs[0] ??
  (await payload.create({
    collection: 'staff',
    data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' },
  }))
// Decisions are stamped from the acting user, so the seed acts as its editor, tagged with its collection as auth would.
const user = { ...staff, collection: 'staff' as const }
const context = { skipRevalidation: true }

const removed = await payload.delete({
  collection: 'races',
  where: { officialUrl: { like: SYNTHETIC_DOMAIN } },
  context,
})
console.log(`Removed ${removed.docs.length} synthetic races`)

let created = 0
let updated = 0
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
      data: { ...data, moderationDecision: 'approve' },
      context,
      user,
    })
    created++
    continue
  }
  // Only a submitted race can be decided; a race staff rejected stays rejected.
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
console.log(`Created ${created} and updated ${updated} real races`)
await refreshRunningSite(payload, [collectionTag('races')])
process.exit(0)
