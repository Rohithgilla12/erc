/**
 * Seeds 3,000 deterministic synthetic races for local work: `pnpm payload run src/scripts/seed-races.ts`.
 * Every race goes through the Local API, so the races hook derives `category` and `band` with @erc/domain.
 * Seeded races are the ones whose official link is on `.example.in`; re-running replaces them and leaves every other race alone.
 */
import config from '@payload-config'
import { addDays, type Discipline, type LocalDate, type Subdivision } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

type RaceData = RequiredDataFromCollectionSlug<'races'>
type Distance = NonNullable<RaceData['distances']>[number]

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed synthetic races in production')

const RACE_COUNT = 3000
const CONCURRENCY = 8

// mulberry32: tiny, fast, and the same sequence on every machine for a given seed.
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const random = prng(20261019)
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
const chance = (p: number) => random() < p
const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0)
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll < 0) return value
  }
  return entries[entries.length - 1]![0]
}

const PLACES: readonly (readonly [Subdivision, number, readonly string[]])[] = [
  ['IN-TS', 30, ['Hyderabad', 'Secunderabad', 'Warangal', 'Karimnagar', 'Nizamabad', 'Khammam', 'Vikarabad']],
  ['IN-AP', 20, ['Visakhapatnam', 'Vijayawada', 'Tirupati', 'Guntur', 'Nellore', 'Kakinada', 'Araku Valley']],
  ['IN-KA', 9, ['Bengaluru', 'Mysuru', 'Coorg', 'Chikmagalur', 'Hampi']],
  ['IN-TN', 7, ['Chennai', 'Coimbatore', 'Ooty', 'Kodaikanal', 'Madurai']],
  ['IN-MH', 7, ['Mumbai', 'Pune', 'Satara', 'Lonavala', 'Nashik']],
  ['IN-KL', 4, ['Kochi', 'Munnar', 'Thiruvananthapuram', 'Wayanad']],
  ['IN-DL', 4, ['New Delhi']],
  ['IN-HP', 3, ['Manali', 'Shimla', 'Dharamshala', 'Spiti']],
  ['IN-UK', 3, ['Dehradun', 'Rishikesh', 'Mussoorie', 'Auli']],
  ['IN-LA', 1, ['Leh', 'Khardung La']],
  ['IN-GA', 2, ['Panaji', 'Margao']],
  ['IN-RJ', 2, ['Jaipur', 'Udaipur', 'Jaisalmer']],
  ['IN-GJ', 2, ['Ahmedabad', 'Vadodara']],
  ['IN-WB', 2, ['Kolkata', 'Darjeeling']],
  ['IN-OD', 1, ['Bhubaneswar', 'Puri']],
  ['IN-CG', 1, ['Raipur']],
  ['IN-ML', 1, ['Shillong', 'Cherrapunji']],
  ['IN-SK', 1, ['Gangtok']],
]
const SUBDIVISION_WEIGHTS = PLACES.map(([code, weight]) => [code, weight] as const)
const CITIES = new Map(PLACES.map(([code, , cities]) => [code, cities]))

const DISCIPLINE_WEIGHTS: readonly (readonly [Discipline, number])[] = [
  ['road', 40],
  ['trail', 22],
  ['mountain', 6],
  ['skyrunning', 3],
  ['cross-country', 5],
  ['track', 5],
  ['virtual', 9],
  ['community', 10],
]

type Template = { metres: readonly number[][]; terrain: Distance['terrain']; climb: [number, number] | null }

/** Each entry is one plausible menu of distances; trail menus carry the odd lengths that categories leave as `other`. */
const MENUS: Record<Discipline, Template> = {
  road: { metres: [[5000, 10000, 21097], [10000, 21097, 42195], [21097], [42195, 21097, 10000, 5000], [10000], [25000, 42195]], terrain: 'road', climb: null },
  trail: {
    metres: [[12000, 25000], [23500, 37000, 54000], [21000, 50000], [35000, 75000, 110000], [50000, 100000, 160934], [8000, 16000, 32000], [60000]],
    terrain: 'trail',
    climb: [200, 6000],
  },
  mountain: { metres: [[18000, 27000], [42000], [15000, 30000, 45000]], terrain: 'trail', climb: [900, 3500] },
  skyrunning: { metres: [[22000], [33000, 56000], [9000]], terrain: 'trail', climb: [1500, 4500] },
  'cross-country': { metres: [[4000, 8000], [6000, 10000], [12000]], terrain: 'mixed', climb: [20, 200] },
  track: { metres: [[5000, 10000], [3000, 5000], [10000]], terrain: 'track', climb: null },
  virtual: { metres: [[5000, 10000, 21097], [10000], [21097, 42195], [100000]], terrain: undefined, climb: null },
  community: { metres: [[3000, 5000], [5000], [2000, 5000, 10000]], terrain: 'road', climb: null },
}

const NAME_WORDS: Record<Discipline, readonly string[]> = {
  road: ['City Marathon', 'Half Marathon', 'Running Festival', 'Monsoon Run', 'Heritage Run', 'Night Run'],
  trail: ['Trail Run', 'Ultra', 'Forest Trail', 'Hills Ultra', 'Lakeside Trail', 'Ridge Run'],
  mountain: ['Mountain Run', 'Hill Climb', 'Peak Challenge'],
  skyrunning: ['Sky Race', 'Vertical Kilometre', 'Skyrun'],
  'cross-country': ['Cross Country', 'XC Championship', 'Mud Run'],
  track: ['Track Meet', 'Track Open', 'Distance Night'],
  virtual: ['Virtual Run', 'Virtual Challenge', 'Run Anywhere'],
  community: ['Parkrun Social', 'Fun Run', 'Charity Run', 'Sunday 5K'],
}

const LISTING_SITES = ['IndiaRunning', 'Townscript', 'RaceRoster India', 'AllEvents']
const START = '2026-06-01' as LocalDate
const TODAY = '2026-10-19' as LocalDate

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const distancesFor = (discipline: Discipline): Distance[] => {
  const { metres, terrain, climb } = MENUS[discipline]
  return pick(metres).map((m) => ({
    metres: m,
    ...(terrain ? { terrain } : {}),
    ...(climb && chance(0.8) ? { elevationGainMetres: Math.round((int(...climb) * m) / 50000 / 10) * 10 || 10 } : {}),
    ...(m >= 42195 && chance(0.6) ? { cutoff: Math.round((m / 1000) * int(500, 900)) } : {}),
  }))
}

const raceAt = (index: number, staffId: number): RaceData => {
  const virtualLocation = chance(0.08)
  const discipline = virtualLocation ? 'virtual' : weighted(DISCIPLINE_WEIGHTS.filter(([d]) => d !== 'virtual'))
  const subdivision = weighted(SUBDIVISION_WEIGHTS)
  const city = pick(CITIES.get(subdivision) ?? [])
  const start = addDays(START, int(0, 579))
  const year = start.slice(0, 4)
  const distances = distancesFor(discipline)
  const longest = Math.max(...distances.map((d) => d.metres))
  const dayCount = longest >= 100000 && chance(0.3) ? int(2, 4) : 1
  const name = `${virtualLocation ? 'ERC' : city} ${pick(NAME_WORDS[discipline])} ${year}`
  const slug = `${slugify(name)}-${index + 1}`
  const site = `https://${slugify(name)}.example.in`

  const moderation = weighted([
    ['approved', 85],
    ['submitted', 10],
    ['rejected', 5],
  ] as const)
  const status = weighted([
    ['scheduled', 95],
    ['postponed', 3],
    ['cancelled', 2],
  ] as const)
  const source = weighted([
    ['organiser', 45],
    ['listing-site', 30],
    ['runner-submission', 15],
    ['coach-knowledge', 10],
  ] as const)
  const listingSite = pick(LISTING_SITES)

  return {
    name,
    slug,
    discipline,
    dates: { start, dayCount },
    timeZone: 'Asia/Kolkata',
    location: virtualLocation
      ? { kind: 'virtual' }
      : { kind: 'venue', venue: `${pick(['Stadium', 'Lake Front', 'Forest Gate', 'Town Hall', 'Base Camp'])}, ${city}`, city, subdivision, country: 'IN' },
    distances,
    officialUrl: site,
    registration: {
      url: `${site}/register`,
      closesOn: chance(0.3) ? null : addDays(start, -int(1, 45)),
    },
    status: status === 'postponed' ? { kind: 'postponed', newStart: chance(0.5) ? addDays(start, int(14, 90)) : null } : { kind: status },
    source:
      source === 'organiser'
        ? { kind: source, url: site }
        : source === 'listing-site'
          ? { kind: source, name: listingSite, url: `https://${slugify(listingSite)}.example.com/e/${index + 1}` }
          : source === 'coach-knowledge'
            ? { kind: source, confirmedBy: staffId }
            : { kind: source },
    lastVerifiedOn: addDays(TODAY, -(chance(0.2) ? int(91, 240) : int(0, 85))),
    summary: `${name}: ${distances.map((d) => `${(d.metres / 1000).toFixed(d.metres % 1000 === 0 ? 0 : 1)} km`).join(', ')}.`,
    moderation:
      moderation === 'submitted'
        ? { state: 'submitted' }
        : moderation === 'approved'
          ? { state: 'approved', decidedBy: staffId, decidedAt: '2026-10-01T09:00:00.000Z' }
          : { state: 'rejected', decidedBy: staffId, decidedAt: '2026-10-01T09:00:00.000Z', reason: 'Could not confirm with the organiser' },
  }
}

const payload = await getPayload({ config })

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({ collection: 'staff', where: { email: { equals: seedEmail } }, limit: 1 })
const staff =
  existingStaff.docs[0] ??
  (await payload.create({ collection: 'staff', data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' } }))

const races = Array.from({ length: RACE_COUNT }, (_, index) => raceAt(index, staff.id))
const context = { skipRevalidation: true }
const removed = await payload.delete({ collection: 'races', where: { officialUrl: { like: '.example.in' } }, context })
console.log(`Removed ${removed.docs.length} previously seeded races`)

const started = performance.now()
let next = 0
const worker = async () => {
  while (next < races.length) {
    const data = races[next++]!
    await payload.create({ collection: 'races', data, context })
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`Created ${races.length} races in ${((performance.now() - started) / 1000).toFixed(1)} s`)
await refreshRunningSite(payload, [collectionTag('races')])
process.exit(0)
