/**
 * Seeds six placeholder athletes with results for local work: `pnpm payload run src/scripts/seed-athletes.ts`.
 * They cover every visibility case: public with results, public with results hidden, a hidden profile, and a public
 * profile with no results yet. Re-running replaces the placeholders (their results go with them) and one placeholder
 * past race that results link to, and leaves everything else alone. Never name real people here.
 */
import config from '@payload-config'
import type { Subdivision } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed placeholder athletes in production')

type AthleteData = RequiredDataFromCollectionSlug<'athletes'>
type Visibility = AthleteData['visibility']
type SeedResult = {
  eventName?: string
  date?: string
  distance: number
  finishTime: string
  official?: boolean
  pending?: boolean
  atRace?: boolean
}

const SLUG_PREFIX = 'placeholder-athlete-'
const RACE_SLUG = 'placeholder-city-10k-2026'

const placeholder = (n: number, home: { city: string; subdivision: Subdivision }, visibility: Visibility, bio: string, runningSince: number | null) =>
  ({
    name: `Placeholder Athlete ${n}`,
    slug: `${SLUG_PREFIX}${n}`,
    bio,
    home,
    runningSince,
    visibility,
    moderation: { state: 'submitted' },
    moderationDecision: 'approve',
  }) satisfies AthleteData

const PUBLIC: Visibility = { profile: 'public', results: 'public' }

const ATHLETES: readonly (readonly [AthleteData, readonly SeedResult[]])[] = [
  [
    placeholder(1, { city: 'Hyderabad', subdivision: 'IN-TS' }, PUBLIC, 'Road runner building towards a first ultra. Placeholder profile for development.', 2018),
    [
      { atRace: true, distance: 10_000, finishTime: '0:44:12' },
      { eventName: 'Placeholder Lakeside 5K', date: '2026-03-08', distance: 5_000, finishTime: '0:21:05' },
      { eventName: 'Placeholder Monsoon 10K', date: '2025-07-20', distance: 10_000, finishTime: '0:45:30' },
      { eventName: 'Placeholder Park Run', date: '2026-05-03', distance: 5_000, finishTime: '0:20:41', official: false },
      { eventName: 'Placeholder City Half', date: '2025-08-24', distance: 21_097, finishTime: '1:39:58' },
      { eventName: 'Placeholder City Marathon', date: '2026-01-18', distance: 42_195, finishTime: '3:41:07' },
      { eventName: 'Placeholder Hills 50K', date: '2026-02-22', distance: 50_000, finishTime: '6:12:40' },
      { eventName: 'Placeholder Fast 10K', date: '2026-09-13', distance: 10_000, finishTime: '0:38:00', pending: true },
    ],
  ],
  [
    placeholder(2, { city: 'Vijayawada', subdivision: 'IN-AP' }, PUBLIC, 'Trail and ultra runner. Placeholder profile for development.', 2014),
    [
      { eventName: 'Placeholder Ghats 50K', date: '2024-12-08', distance: 52_000, finishTime: '7:05:33' },
      { eventName: 'Placeholder Plateau 100K', date: '2025-11-15', distance: 100_000, finishTime: '14:48:02' },
      { eventName: 'Placeholder Forest 100 Miler', date: '2026-04-11', distance: 161_000, finishTime: '29:31:45' },
      { eventName: 'Placeholder River Half', date: '2026-06-14', distance: 21_100, finishTime: '1:52:10', official: false },
    ],
  ],
  [
    placeholder(3, { city: 'Warangal', subdivision: 'IN-TS' }, { profile: 'public', results: 'hidden' }, 'Prefers to keep race times private. Placeholder profile for development.', 2021),
    [
      { eventName: 'Placeholder Private 10K', date: '2026-02-01', distance: 10_000, finishTime: '0:52:00' },
      { eventName: 'Placeholder Private Half', date: '2025-10-05', distance: 21_097, finishTime: '2:01:30' },
    ],
  ],
  [
    placeholder(4, { city: 'Guntur', subdivision: 'IN-AP' }, { profile: 'hidden', results: 'public' }, 'Hidden profile. Placeholder for development.', null),
    [{ eventName: 'Placeholder Hidden Marathon', date: '2025-12-14', distance: 42_195, finishTime: '4:10:00' }],
  ],
  [
    placeholder(5, { city: 'Bengaluru', subdivision: 'IN-KA' }, PUBLIC, 'New to racing. Placeholder profile for development.', 2025),
    [{ eventName: 'Placeholder First 5K', date: '2026-08-02', distance: 5_000, finishTime: '0:29:48' }],
  ],
  [placeholder(6, { city: 'Secunderabad', subdivision: 'IN-TS' }, PUBLIC, '', null), []],
]

const payload = await getPayload({ config })

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({ collection: 'staff', where: { email: { equals: seedEmail } }, limit: 1 })
const staff =
  existingStaff.docs[0] ??
  (await payload.create({ collection: 'staff', data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' } }))
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staff, collection: 'staff' as const }
const context = { skipRevalidation: true }

const removedAthletes = await payload.delete({ collection: 'athletes', where: { slug: { like: SLUG_PREFIX } }, context })
const removedRaces = await payload.delete({ collection: 'races', where: { slug: { equals: RACE_SLUG } }, context })
console.log(`Removed ${removedAthletes.docs.length} placeholder athletes and ${removedRaces.docs.length} placeholder race`)

const race = await payload.create({
  collection: 'races',
  user,
  context,
  data: {
    name: 'Placeholder City 10K 2026',
    slug: RACE_SLUG,
    discipline: 'road',
    dates: { start: '2026-08-16', dayCount: 1 },
    timeZone: 'Asia/Kolkata',
    location: { kind: 'venue', venue: 'Placeholder Stadium', city: 'Hyderabad', subdivision: 'IN-TS', country: 'IN' },
    distances: [{ metres: 10_000 }],
    officialUrl: 'https://example.org/placeholder-city-10k',
    registration: { url: 'https://example.org/placeholder-city-10k/register' },
    status: { kind: 'scheduled' },
    source: { kind: 'organiser', url: 'https://example.org/placeholder-city-10k' },
    lastVerifiedOn: '2026-08-16',
    summary: 'A placeholder past race for development, so seeded results can link to a race page.',
    moderation: { state: 'submitted' },
    moderationDecision: 'approve',
  },
})

let resultCount = 0
for (const [data, results] of ATHLETES) {
  const athlete = await payload.create({ collection: 'athletes', data, user, context })
  for (const { atRace, eventName, date, distance, finishTime, official = true, pending = false } of results) {
    await payload.create({
      collection: 'results',
      user,
      context,
      data: {
        athlete: athlete.id,
        ...(atRace ? { race: race.id } : { eventName, date }),
        distance,
        finishTime,
        provenance: official ? { kind: 'official' } : { kind: 'self_reported' },
        moderation: { state: 'submitted' },
        ...(pending ? {} : { moderationDecision: 'approve' }),
      } as RequiredDataFromCollectionSlug<'results'>,
    })
    resultCount++
  }
}
console.log(`Created ${ATHLETES.length} placeholder athletes with ${resultCount} results`)
await refreshRunningSite(payload, [collectionTag('athletes'), collectionTag('results'), collectionTag('races')])
process.exit(0)
