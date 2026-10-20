/**
 * Proves the athlete and result rules against a migrated database: `pnpm payload run src/scripts/check-athletes.ts`.
 * Set `ERC_CHECK_URL` to a running site (for example `http://localhost:3000`) to repeat the visibility cases over REST
 * and the public pages. Everything it writes is removed.
 */
import config from '@payload-config'
import { deriveAchievements, type RaceResult } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { athleteDirectory, athleteProfile, parseResultDoc } from '@/content/athletes'

import { FORGED_SESSION } from './fixtures/forged-session'

const payload = await getPayload({ config })
const run = Date.now()
const site = process.env.ERC_CHECK_URL?.replace(/\/+$/, '')
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

/** The HTTP status a refused write carries, or `allowed`. */
const outcome = (write: Promise<unknown>) =>
  write.then(
    () => 'allowed',
    (error: { status?: number; message?: string }) => error.status ?? error.message,
  )

/** The fields a refused write names, so a refusal for the wrong reason fails the check. */
const invalidFields = (write: Promise<unknown>) =>
  write.then(
    () => 'allowed',
    (error: { status?: number; data?: { errors?: { path?: string }[] } }) => [error.status, ...(error.data?.errors ?? []).map((e) => e.path)],
  )

const staffDoc = await payload.create({
  collection: 'staff',
  data: { email: `athlete-check-${run}@erc.invalid`, password: `pw-${run}-check`, role: 'editor' },
})
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staffDoc, collection: 'staff' as const }
const asStaff = { user, overrideAccess: false }

type AthleteData = RequiredDataFromCollectionSlug<'athletes'>
type ResultData = RequiredDataFromCollectionSlug<'results'>

const athleteIds: number[] = []
const raceIds: number[] = []

const createAthlete = async (key: string, visibility: AthleteData['visibility'], approve = true) => {
  const doc = await payload.create({
    collection: 'athletes',
    ...asStaff,
    data: {
      name: `Check Athlete ${key} ${run}`,
      slug: `check-athlete-${key}-${run}`,
      home: { city: 'Hyderabad', subdivision: 'IN-TS' },
      visibility,
      moderation: { state: 'submitted' },
      ...(approve ? { moderationDecision: 'approve' } : {}),
    },
  })
  athleteIds.push(doc.id)
  return doc
}

const createResult = (athlete: number, data: Partial<ResultData>, approve = true) =>
  payload.create({
    collection: 'results',
    ...asStaff,
    data: {
      athlete,
      eventName: `Check event ${run}`,
      date: '2026-03-01',
      distance: 10_000,
      provenance: { kind: 'official' },
      moderation: { state: 'submitted' },
      ...(approve ? { moderationDecision: 'approve' } : {}),
      ...data,
      // The hook derives `time` from `finishTime`, which the generated type cannot know.
    } as ResultData,
  })

const ids = (docs: readonly { id: number }[]) => docs.map((doc) => doc.id).sort((a, b) => a - b)

try {
  const shown = await createAthlete('shown', { profile: 'public', results: 'public' })
  const quiet = await createAthlete('quiet', { profile: 'public', results: 'hidden' })
  const hidden = await createAthlete('hidden', { profile: 'hidden', results: 'public' })
  const pending = await createAthlete('pending', { profile: 'public', results: 'public' }, false)

  const official10k = await createResult(shown.id, { finishTime: '0:40:00', eventName: `Shown official 10K ${run}` })
  const self10k = await createResult(shown.id, {
    finishTime: '0:39:30',
    eventName: `Shown self-reported 10K ${run}`,
    date: '2026-04-01',
    provenance: { kind: 'self_reported', evidenceUrl: 'https://example.org/evidence', timingUrl: 'https://example.org/stale' },
  })
  const unapproved10k = await createResult(shown.id, { finishTime: '0:30:00', eventName: `Shown unapproved 10K ${run}` }, false)
  const ultra = await createResult(shown.id, { finishTime: '6:00:00', distance: 50_000, eventName: `Shown 50K ${run}`, date: '2025-11-01' })
  const quietResult = await createResult(quiet.id, { finishTime: '0:20:00', distance: 5_000, eventName: `Quiet private 5K ${run}` })
  const hiddenResult = await createResult(hidden.id, { finishTime: '3:30:00', distance: 42_195, eventName: `Hidden marathon ${run}` })
  const pendingResult = await createResult(pending.id, { finishTime: '1:40:00', distance: 21_097, eventName: `Pending half ${run}` })
  const shownApproved = [official10k, self10k, ultra]
  const fixtureSlugs = [shown, quiet, hidden, pending].map((athlete) => athlete.slug)

  // Read access, which REST and the content layer both go through.
  const anonymousAthletes = await payload.find({ collection: 'athletes', overrideAccess: false, where: { id: { in: athleteIds } } })
  expect('anonymous sees only approved public profiles', ids(anonymousAthletes.docs), [shown.id, quiet.id])
  const anonymousResults = await payload.find({ collection: 'results', overrideAccess: false, where: { athlete: { in: athleteIds } } })
  expect('anonymous sees only approved results of athletes who show them', ids(anonymousResults.docs), ids(shownApproved))
  const askedForHidden = await payload.find({
    collection: 'results',
    overrideAccess: false,
    where: { or: [{ athlete: { equals: hidden.id } }, { 'athlete.visibility.results': { equals: 'hidden' } }, { id: { equals: unapproved10k.id } }] },
  })
  expect('anonymous cannot query its way to hidden or unapproved results', askedForHidden.totalDocs, 0)
  const byIdHidden = await outcome(payload.findByID({ collection: 'athletes', id: hidden.id, overrideAccess: false }))
  expect('anonymous read of a hidden athlete by id is refused', byIdHidden, 404)
  const staffResults = await payload.find({ collection: 'results', ...asStaff, where: { athlete: { in: athleteIds } } })
  expect('staff see every result', staffResults.totalDocs, 7)

  // The content layer, which public pages read through.
  const directory = await athleteDirectory(payload)
  const listed = directory.filter((entry) => fixtureSlugs.includes(entry.athlete.slug))
  expect('directory lists public profiles only', listed.map((entry) => entry.athlete.slug).sort(), [shown.slug, quiet.slug].sort())
  expect(
    'directory shows no bests for an athlete with hidden results',
    listed.find((entry) => entry.athlete.id === quiet.id)?.headline,
    [],
  )
  expect('hidden profile has no page', await athleteProfile(payload, hidden.slug), null)
  expect('unapproved athlete has no page', await athleteProfile(payload, pending.slug), null)
  expect('a public profile with hidden results shows no record', (await athleteProfile(payload, quiet.slug))?.record, { visibility: 'hidden' })

  const profile = await athleteProfile(payload, shown.slug)
  const record = profile?.record
  expect('results are listed newest first, approved only', record?.visibility === 'public' ? record.results.map((r) => r.id) : null, [
    self10k.id,
    official10k.id,
    ultra.id,
  ])
  // An independent read: every stored row for the athlete, parsed and handed to deriveAchievements.
  const stored = await payload.find({ collection: 'results', where: { athlete: { equals: shown.id } }, depth: 0, pagination: false })
  const storedResults = stored.docs.flatMap((doc): RaceResult[] => {
    const parsed = parseResultDoc(doc)
    return parsed.ok ? [parsed.value] : []
  })
  expect('stored rows include the unapproved result only as unparseable', storedResults.length, 3)
  expect(
    'profile bests match deriveAchievements over the stored results',
    record?.visibility === 'public' ? record.achievements : null,
    deriveAchievements(storedResults),
  )
  expect('the faster self-reported 10K is the best, marked unverified', record?.visibility === 'public' ? record.achievements.bests['10k'] : null, {
    time: 2_370,
    result: self10k.id,
    verified: false,
  })

  // Hooks: finish time, derived category, race fill, provenance links, refusals.
  expect('finish time is stored in seconds', official10k.time, 2_400)
  expect('finish time reads back as h:mm:ss', (await payload.findByID({ collection: 'results', id: official10k.id })).finishTime, '0:40:00')
  expect('category is derived from the distance', [official10k.category, ultra.category, quietResult.category, hiddenResult.category, pendingResult.category], [
    '10k',
    'ultra-50k',
    '5k',
    'marathon',
    'half',
  ])
  expect('only the chosen provenance keeps its link', [self10k.provenance.evidenceUrl, self10k.provenance.timingUrl], ['https://example.org/evidence', null])
  expect('a minutes-only time is refused', await invalidFields(createResult(shown.id, { finishTime: '39:30' })), [400, 'finishTime', 'time'])
  expect('a result without a finish time is refused', await invalidFields(createResult(shown.id, {})), [400, 'finishTime', 'time'])
  expect('a future result is refused', await invalidFields(createResult(shown.id, { finishTime: '0:40:00', date: '2999-01-01' })), [400, 'date'])
  const sentSeconds = await createResult(shown.id, { finishTime: '0:41:00', time: 1 })
  expect('a sent time in seconds is ignored in favour of the finish time', sentSeconds.time, 2_460)
  await payload.delete({ collection: 'results', id: sentSeconds.id })

  const renamed = await payload.update({ collection: 'results', id: official10k.id, ...asStaff, data: { eventName: `Renamed ${run}` } })
  expect('an update without a finish time keeps the stored time', renamed.time, 2_400)
  const retimed = await payload.update({ collection: 'results', id: official10k.id, ...asStaff, data: { finishTime: '0:40:05' } })
  expect('an update with a finish time changes it', retimed.time, 2_405)

  const race = await payload.create({
    collection: 'races',
    ...asStaff,
    data: {
      name: `Check stage race ${run}`,
      slug: `check-stage-race-${run}`,
      discipline: 'trail',
      dates: { start: '2026-02-10', dayCount: 3 },
      timeZone: 'Asia/Kolkata',
      location: { kind: 'virtual' },
      distances: [{ metres: 120_000 }],
      officialUrl: 'https://example.org',
      registration: { url: 'https://example.org' },
      status: { kind: 'scheduled' },
      source: { kind: 'runner-submission' },
      lastVerifiedOn: '2026-02-01',
      summary: 'check',
      moderation: { state: 'submitted' },
      moderationDecision: 'approve',
    },
  })
  raceIds.push(race.id)
  const atRace = await createResult(shown.id, { race: race.id, eventName: undefined, date: undefined, distance: 120_000, finishTime: '30:00:00' })
  expect('a linked race fills the event name and date', [atRace.eventName, atRace.date], [race.name, '2026-02-10'])
  expect('a long result at a multi-day race is a multi-day ultra', atRace.category, 'ultra-multiday')
  const tenKAtRace = await createResult(shown.id, { race: race.id, eventName: undefined, date: undefined, finishTime: '0:50:00' })
  expect('a 10K at a multi-day race stays a 10K', tenKAtRace.category, '10k')
  const raceSlugs = (await athleteProfile(payload, shown.slug))?.raceSlugs
  expect('the profile links the result to its race', raceSlugs, { [race.id]: race.slug })

  if (site) await overHttp({ shown, quiet, hidden, pending, hiddenResult, quietResult, unapproved10k, pendingResult })
  else console.log('SKIP REST and page checks: set ERC_CHECK_URL to a running site')

  await payload.delete({ collection: 'athletes', id: shown.id, ...asStaff })
  const orphans = await payload.find({ collection: 'results', where: { athlete: { equals: shown.id } } })
  expect('deleting an athlete deletes their results', orphans.totalDocs, 0)
} finally {
  await payload.delete({ collection: 'athletes', where: { id: { in: athleteIds } } })
  if (raceIds.length > 0) await payload.delete({ collection: 'races', where: { id: { in: raceIds } } })
  await payload.delete({ collection: 'staff', id: staffDoc.id })
}

type Doc = { id: number; slug?: string; name?: string; eventName?: string }

async function overHttp(f: Record<'shown' | 'quiet' | 'hidden' | 'pending', Doc> & Record<'hiddenResult' | 'quietResult' | 'unapproved10k' | 'pendingResult', Doc>) {
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${site}${path}`, { headers })
    return { status: response.status, body: await response.text() }
  }
  // Past the API gate as an anonymous reader, so these cases still test the collections' read access.
  const api = (path: string) => get(path, FORGED_SESSION)
  const privateResultIds = [f.hiddenResult.id, f.quietResult.id, f.unapproved10k.id, f.pendingResult.id]

  const athletesApi = JSON.parse((await api('/api/athletes?limit=1000&depth=0')).body) as { docs: Doc[] }
  expect('REST /api/athletes omits hidden and unapproved profiles', athletesApi.docs.filter((d) => [f.hidden.id, f.pending.id].includes(d.id)), [])
  expect('REST /api/athletes lists the public profiles', athletesApi.docs.filter((d) => [f.shown.id, f.quiet.id].includes(d.id)).length, 2)
  const resultsApi = JSON.parse((await api('/api/results?limit=1000&depth=1')).body) as { docs: Doc[] }
  expect('REST /api/results omits hidden and unapproved results', resultsApi.docs.filter((d) => privateResultIds.includes(d.id)), [])
  expect('REST /api/results by id of a hidden result is refused', (await api(`/api/results/${f.hiddenResult.id}`)).status, 404)
  expect('REST without a session is not found', [(await get('/api/athletes')).status, (await get('/api/results')).status], [404, 404])

  const directoryPage = await get('/athletes')
  expect('the directory names public athletes only', [f.shown, f.quiet, f.hidden, f.pending].map((a) => directoryPage.body.includes(a.name ?? '')), [
    true,
    true,
    false,
    false,
  ])
  expect('a hidden profile 404s', (await get(`/athletes/${f.hidden.slug}`)).status, 404)
  expect('an unapproved profile 404s', (await get(`/athletes/${f.pending.slug}`)).status, 404)
  const quietPage = await get(`/athletes/${f.quiet.slug}`)
  expect('a profile with hidden results renders without them', [quietPage.status, quietPage.body.includes(f.quietResult.eventName ?? '')], [200, false])
  const shownPage = await get(`/athletes/${f.shown.slug}`)
  expect('a public profile renders without its unapproved result', [shownPage.status, shownPage.body.includes(f.unapproved10k.eventName ?? '')], [200, false])
  type Node = { '@type': string; mainEntity?: object }
  const jsonLd = [...shownPage.body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].flatMap(
    (m) => (JSON.parse(m[1]!) as { '@graph': Node[] })['@graph'],
  )
  const profile = jsonLd.find((value) => value['@type'] === 'ProfilePage')
  expect(
    'ProfilePage and Person JSON-LD carry only type, name, and URL',
    [profile ? Object.keys(profile).sort() : null, profile?.mainEntity ? Object.keys(profile.mainEntity).sort() : null],
    [
      ['@type', 'mainEntity', 'url'],
      ['@type', 'name', 'url'],
    ],
  )
  expect('the profile has breadcrumbs', jsonLd.some((value) => value['@type'] === 'BreadcrumbList'), true)

  // The pages above are now cached; hiding must expire them, not wait out the cache.
  const shownResultNames = [`Renamed ${run}`, `Shown 50K ${run}`]
  expect('the cached profile showed those results before', shownResultNames.map((name) => shownPage.body.includes(name)), [true, true])
  await payload.update({ collection: 'athletes', id: f.shown.id, ...asStaff, data: { visibility: { profile: 'public', results: 'hidden' } } })
  const nowQuiet = await get(`/athletes/${f.shown.slug}`)
  expect('hiding results takes them off the cached profile', [nowQuiet.status, shownResultNames.some((name) => nowQuiet.body.includes(name))], [200, false])
  const resultsAfter = JSON.parse((await api(`/api/results?where[athlete][equals]=${f.shown.id}`)).body) as { totalDocs: number }
  expect('hiding results takes them off REST', resultsAfter.totalDocs, 0)
  await payload.update({ collection: 'athletes', id: f.shown.id, ...asStaff, data: { visibility: { profile: 'hidden', results: 'hidden' } } })
  expect('hiding the profile 404s the cached page', (await get(`/athletes/${f.shown.slug}`)).status, 404)
  expect('hiding the profile takes it off the cached directory', (await get('/athletes')).body.includes(f.shown.name ?? ''), false)
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All athlete checks passed')
process.exit(0)
