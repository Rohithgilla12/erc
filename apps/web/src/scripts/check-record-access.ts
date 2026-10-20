/**
 * Proves the record read rules against a migrated database: `pnpm payload run src/scripts/check-record-access.ts`.
 * Everything it writes is removed.
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
const db = payload.db.drizzle
const run = Date.now()
const slugs = { approved: `access-check-approved-${run}`, submitted: `access-check-submitted-${run}` }
const submitterEmail = `submitter-${run}@example.com`
const submitter = { name: 'Check Submitter', email: submitterEmail }
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const insertRace = (slug: string, state: 'approved' | 'submitted') =>
  db.execute(sql`
    WITH race AS (
      INSERT INTO races (name, slug, discipline, dates_start, dates_day_count, time_zone, location_kind,
        official_url, registration_url, status_kind, source_kind, last_verified_on, summary, moderation_state,
        moderation_submitter_name, moderation_submitter_email)
      VALUES (${slug}, ${slug}, 'road', '2099-01-01', 1, 'Asia/Kolkata', 'virtual',
        'https://example.org', 'https://example.org', 'scheduled', 'runner-submission', '2026-10-19', 'check', ${state},
        'Check Submitter', ${submitterEmail})
      RETURNING id
    )
    INSERT INTO races_distances (_order, _parent_id, id, metres, category, band)
    SELECT 1, id, ${`${slug}-d`}, 10000, '10k', '10k-to-half' FROM race`)

const visibleSlugs = async (user?: Record<string, unknown>) => {
  const { docs } = await payload.find({
    collection: 'races',
    overrideAccess: false,
    ...(user ? { user } : {}),
    where: { slug: { in: Object.values(slugs) } },
    sort: 'slug',
  })
  return docs.map((race) => race.slug)
}

const staff = await payload.create({
  collection: 'staff',
  data: { email: `access-check-${run}@erc.invalid`, password: `pw-${run}-check`, role: 'editor' },
})
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const staffUser = { ...staff, collection: 'staff' as const }
let athleteId: number | null = null

try {
  await insertRace(slugs.approved, 'approved')
  await insertRace(slugs.submitted, 'submitted')

  expect('anonymous sees only approved races', await visibleSlugs(), [slugs.approved])
  expect('staff see every race', await visibleSlugs(staffUser), [slugs.approved, slugs.submitted])

  const asked = await payload.find({
    collection: 'races',
    overrideAccess: false,
    where: { 'moderation.state': { equals: 'submitted' }, slug: { equals: slugs.submitted } },
  })
  expect('anonymous cannot query its way to a submitted race', asked.totalDocs, 0)

  const distances = await payload.find({ collection: 'races', overrideAccess: false, where: { slug: { equals: slugs.approved } } })
  expect('approved race reads with its distances', distances.docs[0]?.distances?.map((d) => d.band), ['10k-to-half'])

  const anonymousStaff = await payload.find({ collection: 'staff', overrideAccess: false }).then(
    () => 'allowed',
    (error: { status?: number }) => error.status,
  )
  expect('anonymous is refused staff accounts', anonymousStaff, 403)

  const approvedRace = { collection: 'races', overrideAccess: false, where: { slug: { equals: slugs.approved } } } as const
  expect('anonymous reads of an approved race leave out who submitted it', (await payload.find(approvedRace)).docs[0]?.moderation.submitter, undefined)
  expect('staff read who submitted a race', (await payload.find({ ...approvedRace, user: staffUser })).docs[0]?.moderation.submitter, submitter)

  const athlete = await payload.create({
    collection: 'athletes',
    user: staffUser,
    overrideAccess: false,
    data: {
      name: `Access Check ${run}`,
      slug: `access-check-athlete-${run}`,
      home: { city: 'Hyderabad', subdivision: 'IN-TS' },
      visibility: { profile: 'public', results: 'public' },
      moderation: { state: 'submitted', submitter },
      moderationDecision: 'approve',
    },
  })
  athleteId = athlete.id
  const approvedAthlete = { collection: 'athletes', id: athlete.id, overrideAccess: false } as const
  expect('anonymous reads of an approved athlete leave out who submitted it', (await payload.findByID(approvedAthlete)).moderation.submitter, undefined)
  expect('staff read who submitted an athlete', (await payload.findByID({ ...approvedAthlete, user: staffUser })).moderation.submitter, submitter)
} finally {
  if (athleteId !== null) await payload.delete({ collection: 'athletes', id: athleteId })
  await db.execute(sql`DELETE FROM races WHERE slug IN (${slugs.approved}, ${slugs.submitted})`)
  await payload.delete({ collection: 'staff', id: staff.id })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All record access checks passed')
process.exit(0)
