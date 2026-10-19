/**
 * Proves the editorial workflow, moderation, staff deletion, and race slug rules against a migrated database:
 * `pnpm payload run src/scripts/check-write-rules.ts`. Set `ERC_CHECK_URL` to a running site (for example
 * `http://localhost:3000`) to repeat the editorial cases over REST. Everything it writes is removed.
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import type { Coach, Staff } from '@/payload-types'

const payload = await getPayload({ config })
const db = payload.db.drizzle
const run = Date.now()
const password = `pw-${run}-check`
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

type StaffUser = Staff & { collection: 'staff' }

// A fresh context per call: Payload writes request state into it, and these calls must not share any.
const system = () => ({ context: { skipRevalidation: true } })
const as = (user: StaffUser) => ({ user, overrideAccess: false, ...system() })

const createStaff = async (role: Staff['role'], name: string = role): Promise<StaffUser> => {
  const doc = await payload.create({
    collection: 'staff',
    data: { email: `write-check-${name}-${run}@erc.invalid`, password, role },
    ...system(),
  })
  // Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
  return { ...doc, collection: 'staff' }
}


const author = await createStaff('author')
const editor = await createStaff('editor')
const coachIds: number[] = []
const raceIds: number[] = []

const coachData = (slug: string, credentials: string): RequiredDataFromCollectionSlug<'coaches'> => ({
  name: slug,
  slug,
  credentials,
})

const publicCredentials = async (slug: string, draft: boolean) => {
  const { docs } = await payload.find({ collection: 'coaches', overrideAccess: false, draft, where: { slug: { equals: slug } } })
  return docs.map((coach) => coach.credentials)
}

const workingCopy = (id: number) => payload.findByID({ collection: 'coaches', id, draft: true, ...as(editor) })

const stateOf = async (id: number) => {
  const { workflow } = (await workingCopy(id)) as Coach & { workflow: { live: { kind: string }; revision: { kind: string } } }
  return { live: workflow.live.kind, revision: workflow.revision.kind }
}

const latestVersionStatus = async (id: number) => {
  const { rows } = await db.execute(sql`SELECT version__status FROM _coaches_v WHERE parent_id = ${id} AND latest`)
  return rows.map((row) => row.version__status)
}

async function editorialCases() {
  const slug = `write-check-coach-${run}`
  const coach = await payload.create({
    collection: 'coaches',
    data: { ...coachData(slug, 'v1 live'), _status: 'published' },
    ...as(editor),
  })
  coachIds.push(coach.id)
  expect('an editor can create and publish in one save', await publicCredentials(slug, false), ['v1 live'])

  await payload.update({ collection: 'coaches', id: coach.id, data: { credentials: 'v2 revision' }, draft: true, ...as(author) })
  expect('an author draft save opens a revision on the published doc', await stateOf(coach.id), { live: 'published', revision: 'draft' })
  expect('the revision is stored as a draft version, not stamped published', await latestVersionStatus(coach.id), ['draft'])
  const draftRead = await publicCredentials(slug, true)
  expect('anonymous draft: true never returns the unpublished revision', draftRead.includes('v2 revision'), false)
  expect('anonymous reads still get the live copy', await publicCredentials(slug, false), ['v1 live'])

  expect(
    "an author's non-draft save of a published doc is refused",
    await outcome(payload.update({ collection: 'coaches', id: coach.id, data: { credentials: 'v3 author live' }, ...as(author) })),
    403,
  )
  expect(
    'an author cannot send _status: published',
    await outcome(payload.update({ collection: 'coaches', id: coach.id, data: { _status: 'published' }, ...as(author) })),
    403,
  )
  expect('an author cannot use the Unpublish signal', await outcome(payload.update({ collection: 'coaches', id: coach.id, data: { _status: 'draft' }, ...as(author) })), 403)
  expect('live is unchanged after the refused author saves', await publicCredentials(slug, false), ['v1 live'])

  await payload.update({ collection: 'coaches', id: coach.id, data: { reviewRequest: 'submit' }, draft: true, ...as(author) })
  expect('an author submits the revision for review', await stateOf(coach.id), { live: 'published', revision: 'in_review' })
  expect(
    'an author cannot request changes',
    await outcome(
      payload.update({ collection: 'coaches', id: coach.id, data: { reviewRequest: 'request_changes', reviewNote: 'x' }, draft: true, ...as(author) }),
    ),
    403,
  )
  expect(
    'request changes needs a note',
    await outcome(payload.update({ collection: 'coaches', id: coach.id, data: { reviewRequest: 'request_changes' }, draft: true, ...as(editor) })),
    400,
  )
  await payload.update({
    collection: 'coaches',
    id: coach.id,
    data: { reviewRequest: 'request_changes', reviewNote: 'Name the certifying body' },
    draft: true,
    ...as(editor),
  })
  expect('an editor requests changes', await stateOf(coach.id), { live: 'published', revision: 'changes_requested' })
  await payload.update({ collection: 'coaches', id: coach.id, data: { reviewRequest: 'submit' }, draft: true, ...as(author) })

  const before = (await workingCopy(coach.id)).workflow as { live: { at: string } }
  await payload.update({ collection: 'coaches', id: coach.id, data: { _status: 'published' }, ...as(editor) })
  expect("an editor's publish promotes the revision to live", await publicCredentials(slug, false), ['v2 revision'])
  expect('publish clears the revision', await stateOf(coach.id), { live: 'published', revision: 'none' })
  const after = (await workingCopy(coach.id)).workflow as { live: { at: string; by: number } }
  expect('publish restamps live with the publisher', [after.live.at > before.live.at, after.live.by], [true, editor.id])

  await payload.update({ collection: 'coaches', id: coach.id, data: { _status: 'draft' }, ...as(editor) })
  expect('unpublish hides the doc from anonymous reads', await publicCredentials(slug, false), [])
  expect('unpublish hides the doc from anonymous draft reads', await publicCredentials(slug, true), [])
  expect('unpublish keeps the content as a draft revision', await stateOf(coach.id), { live: 'none', revision: 'draft' })
}

const raceData = (slug: string): RequiredDataFromCollectionSlug<'races'> => ({
  name: slug,
  slug,
  discipline: 'road',
  dates: { start: '2099-01-01', dayCount: 1 },
  timeZone: 'Asia/Kolkata',
  location: { kind: 'virtual' },
  distances: [{ metres: 10000 }],
  officialUrl: 'https://example.org/race',
  registration: { url: 'https://example.org/register' },
  status: { kind: 'scheduled' },
  source: { kind: 'runner-submission' },
  lastVerifiedOn: '2026-10-19',
  summary: 'Write rule check',
  moderation: { state: 'submitted' },
})

const moderationOf = async (id: number) => {
  const { moderation } = await payload.findByID({ collection: 'races', id, depth: 0, ...as(editor) })
  return moderation
}

const secondsAgo = (instant: string | null | undefined) => (instant ? (Date.now() - Date.parse(instant)) / 1000 : Infinity)

async function moderationCases() {
  const forged = { decidedBy: author.id, decidedAt: '2001-01-01T00:00:00.000Z' }
  const race = await payload.create({
    collection: 'races',
    data: {
      ...raceData(`write-check-race-${run}`),
      moderation: { state: 'approved', ...forged, submitter: { name: 'Asha Rao', email: 'asha@example.com' } },
    },
    ...as(editor),
  })
  raceIds.push(race.id)
  const created = await moderationOf(race.id)
  expect('a typed state on create is discarded', [created.state, created.decidedBy ?? null], ['submitted', null])
  expect('a public submitter is stored', created.submitter, { name: 'Asha Rao', email: 'asha@example.com' })
  expect('submittedAt comes from the clock', secondsAgo(created.submittedAt) < 60, true)

  expect(
    'an author cannot approve a race',
    await outcome(payload.update({ collection: 'races', id: race.id, data: { moderationDecision: 'approve' }, ...as(author) })),
    403,
  )
  await payload.update({ collection: 'races', id: race.id, data: { moderation: { state: 'approved', ...forged } }, ...as(author) })
  const typed = await moderationOf(race.id)
  expect('an author typing the moderation group changes nothing', [typed.state, typed.decidedBy ?? null], ['submitted', null])
  expect(
    'a rejection needs a reason',
    await outcome(payload.update({ collection: 'races', id: race.id, data: { moderationDecision: 'reject' }, ...as(editor) })),
    400,
  )

  await payload.update({
    collection: 'races',
    id: race.id,
    data: { moderationDecision: 'approve', moderation: { state: 'submitted', ...forged } },
    ...as(editor),
  })
  const decided = await moderationOf(race.id)
  expect('an editor approves', decided.state, 'approved')
  expect('decidedBy is the acting editor, not the forged id', decided.decidedBy, editor.id)
  expect('decidedAt is the clock, not the forged time', secondsAgo(decided.decidedAt) < 60, true)
  expect('the submitter survives the decision', decided.submitter, { name: 'Asha Rao', email: 'asha@example.com' })
  expect(
    'a decided race cannot be decided again',
    await outcome(payload.update({ collection: 'races', id: race.id, data: { moderationDecision: 'reject', rejectionReason: 'x' }, ...as(editor) })),
    409,
  )
}

async function staffDeletionCases() {
  const coach = await createStaff('author', 'coach')
  const race = await payload.create({
    collection: 'races',
    data: { ...raceData(`write-check-confirmed-${run}`), source: { kind: 'coach-knowledge', confirmedBy: coach.id } },
    ...system(),
  })
  raceIds.push(race.id)
  expect(
    'deleting a staff member who confirmed a race is refused',
    await outcome(payload.delete({ collection: 'staff', id: coach.id, ...system() })),
    409,
  )
  const kept = await payload.findByID({ collection: 'races', id: race.id, depth: 0, ...system() })
  expect('the race keeps its confirming staff member', kept.source.confirmedBy, coach.id)
  expect(
    'deleting the editor who approved a race is refused',
    await outcome(payload.delete({ collection: 'staff', id: editor.id, ...system() })),
    409,
  )
  await payload.delete({ collection: 'races', id: race.id, ...system() })
  raceIds.splice(raceIds.indexOf(race.id), 1)
  expect('with no races left, the staff member can be deleted', await outcome(payload.delete({ collection: 'staff', id: coach.id, ...system() })), 'allowed')
}

async function reservedSlugCases() {
  for (const slug of ['in', 'discipline']) {
    expect(
      `a race cannot take the landing route slug "${slug}"`,
      await outcome(payload.create({ collection: 'races', data: raceData(slug), ...system() }).then((race) => raceIds.push(race.id))),
      400,
    )
  }
}

async function restEditorialCases(site: string) {
  const login = async (user: StaffUser) => {
    const response = await fetch(new URL('/api/staff/login', site), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    const { token } = (await response.json()) as { token: string }
    return { authorization: `JWT ${token}`, 'content-type': 'application/json' }
  }
  const authorHeaders = await login(author)
  const editorHeaders = await login(editor)
  const slug = `write-check-rest-${run}`
  const coach = await payload.create({ collection: 'coaches', data: { ...coachData(slug, 'rest live'), _status: 'published' }, ...as(editor) })
  coachIds.push(coach.id)

  const patch = (headers: Record<string, string>, query: string, body: object) =>
    fetch(new URL(`/api/coaches/${coach.id}${query}`, site), { method: 'PATCH', headers, body: JSON.stringify(body) }).then((r) => r.status)
  const anonymous = async (draft: boolean) => {
    const response = await fetch(new URL(`/api/coaches?where[slug][equals]=${slug}${draft ? '&draft=true' : ''}`, site))
    const { docs } = (await response.json()) as { docs: Coach[] }
    return docs.map((doc) => doc.credentials)
  }
  const anonymousById = async () => {
    const response = await fetch(new URL(`/api/coaches/${coach.id}?draft=true`, site))
    return response.ok ? ((await response.json()) as Coach).credentials : response.status
  }

  expect('REST: an author Save Draft succeeds', await patch(authorHeaders, '?draft=true', { credentials: 'rest revision' }), 200)
  expect('REST: anonymous ?draft=true list never returns the revision', (await anonymous(true)).includes('rest revision'), false)
  expect('REST: anonymous ?draft=true by id never returns the revision', await anonymousById(), 'rest live')
  expect("REST: an author's non-draft PATCH is refused", await patch(authorHeaders, '', { credentials: 'rest author live' }), 403)
  expect('REST: live is unchanged after the refused PATCH', await anonymous(false), ['rest live'])
  expect('REST: the Publish button shape publishes for an editor', await patch(editorHeaders, '', { _status: 'published' }), 200)
  expect('REST: the published revision is live', await anonymous(false), ['rest revision'])
  expect('REST: the Unpublish button shape unpublishes for an editor', await patch(editorHeaders, '', { _status: 'draft' }), 200)
  expect('REST: an unpublished doc is gone from anonymous reads', await anonymous(false), [])

  const race = await payload.create({ collection: 'races', data: raceData(`write-check-rest-race-${run}`), ...as(editor) })
  raceIds.push(race.id)
  const decideRace = (headers: Record<string, string>) =>
    fetch(new URL(`/api/races/${race.id}`, site), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ moderationDecision: 'approve', moderation: { decidedBy: author.id } }),
    }).then((r) => r.status)
  expect('REST: an author cannot approve a race', await decideRace(authorHeaders), 403)
  expect('REST: an editor approves a race', await decideRace(editorHeaders), 200)
  expect('REST: decidedBy is the editor despite the forged id', (await moderationOf(race.id)).decidedBy, editor.id)
}

try {
  await editorialCases()
  await moderationCases()
  await staffDeletionCases()
  await reservedSlugCases()
  const site = process.env.ERC_CHECK_URL
  if (site) await restEditorialCases(site)
  else console.log('SKIP REST cases: set ERC_CHECK_URL to a running site')
} finally {
  for (const id of coachIds) await payload.delete({ collection: 'coaches', id, ...system() })
  for (const id of raceIds) await payload.delete({ collection: 'races', id, ...system() })
  for (const user of [author, editor]) await payload.delete({ collection: 'staff', id: user.id, ...system() })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All write rule checks passed')
process.exit(0)
