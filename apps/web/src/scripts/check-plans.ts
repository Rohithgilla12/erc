/**
 * Proves the plan and download rules against a migrated, seeded database:
 * `pnpm payload run src/scripts/check-plans.ts` after `seed-plans.ts`. With `ERC_CHECK_URL=<site>` it also checks the
 * pages and `/downloads` over HTTP; the site must share this database and `REVALIDATE_SECRET`. Everything it writes
 * is removed.
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { minimalPdf } from './fixtures/pdf'

const payload = await getPayload({ config })
const site = process.env.ERC_CHECK_URL ?? null
const run = Date.now()
const slugs = { plan: `check-plan-${run}`, draftPdf: `check-draft-pdf-${run}` }
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const rejects = async (label: string, attempt: () => Promise<unknown>, pattern: RegExp) => {
  try {
    await attempt()
    expect(label, 'accepted', 'rejected')
  } catch (error) {
    const message = String((error as { data?: unknown }).data ? JSON.stringify((error as { data: unknown }).data) : error)
    expect(label, pattern.test(message) ? 'rejected' : message, 'rejected')
  }
}

const get = (path: string) => fetch(new URL(path, site ?? 'http://invalid'), { redirect: 'manual' })

const anonymousSlugs = async (collection: 'trainingPlans' | 'resources', slug: string) =>
  (await payload.find({ collection, overrideAccess: false, where: { slug: { equals: slug } } })).docs.map((doc) => doc.slug)

const staff = await payload.create({
  collection: 'staff',
  data: { email: `plans-check-${run}@erc.invalid`, password: `pw-${run}-check`, role: 'editor' },
})
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staff, collection: 'staff' as const }
const seeded = await payload.find({ collection: 'trainingPlans', where: { slug: { equals: 'beginner-5k-placeholder' } }, depth: 1 })
const seededPlan = seeded.docs[0]
if (!seededPlan) throw new Error('Run src/scripts/seed-plans.ts first')
const seededPdf = seededPlan.pdf
if (typeof seededPdf !== 'object' || !seededPdf) throw new Error('The seeded plan has no PDF')

const pdf = minimalPdf(['Check fixture'])
const pdfFile = { data: pdf, mimetype: 'application/pdf', name: `check-${run}.pdf`, size: pdf.length }
const resourceData = { title: 'Check', description: 'Placeholder: check fixture.', category: 'guide', access: { kind: 'free' } } as const
const createdResources: number[] = []
let planId: number | null = null

try {
  const draftPdf = await payload.create({ collection: 'resources', data: { ...resourceData, slug: slugs.draftPdf }, file: pdfFile, user, draft: true })
  createdResources.push(draftPdf.id)
  expect('anonymous readers cannot list a draft download', await anonymousSlugs('resources', slugs.draftPdf), [])

  await rejects(
    'a file over 20 MB is refused',
    async () => {
      const big = Buffer.concat([pdf, Buffer.alloc(20 * 1024 * 1024)])
      const doc = await payload.create({
        collection: 'resources',
        data: { ...resourceData, slug: `check-big-${run}` },
        file: { ...pdfFile, data: big, size: big.length },
        user,
        draft: true,
      })
      createdResources.push(doc.id)
    },
    /at most 20 MB/,
  )
  await rejects(
    'a file type outside the list is refused',
    async () => {
      const exe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1')
      const doc = await payload.create({
        collection: 'resources',
        data: { ...resourceData, slug: `check-exe-${run}` },
        file: { data: exe, mimetype: 'application/x-msdownload', name: `check-${run}.exe`, size: exe.length },
        user,
        draft: true,
      })
      createdResources.push(doc.id)
    },
    /not allowed|Invalid MIME/i,
  )

  // Array rows carry their own ids, which would collide with the seeded plan's rows.
  const weeks: typeof seededPlan.weeks = JSON.parse(JSON.stringify(seededPlan.weeks, (key, value) => (key === 'id' ? undefined : value)))
  const plan = await payload.create({
    collection: 'trainingPlans',
    data: {
      title: `Check plan ${run}`,
      goal: seededPlan.goal,
      level: seededPlan.level,
      prerequisites: seededPlan.prerequisites,
      audience: seededPlan.audience,
      overview: seededPlan.overview,
      weeks,
      access: seededPlan.access,
      slug: slugs.plan,
      coaches: seededPlan.coaches.map((coach) => (typeof coach === 'object' ? coach.id : coach)),
      pdf: null,
      _status: 'published',
    },
    user,
    draft: false,
  })
  planId = plan.id
  expect('anonymous readers see a published plan', await anonymousSlugs('trainingPlans', slugs.plan), [slugs.plan])
  if (site) expect('a published plan has a page', (await get(`/plans/${slugs.plan}`)).status, 200)

  await payload.update({ collection: 'trainingPlans', id: plan.id, data: { _status: 'draft' }, user, draft: false })
  expect('anonymous readers cannot see an unpublished plan', await anonymousSlugs('trainingPlans', slugs.plan), [])

  if (site) {
    expect('an unpublished plan has no page', (await get(`/plans/${slugs.plan}`)).status, 404)
    expect('the plan list leaves an unpublished plan out', (await (await get('/plans')).text()).includes(slugs.plan), false)

    const page = await (await get('/plans/beginner-5k-placeholder')).text()
    expect('the 5K page lists one schedule entry per week', page.match(/<li class="week">/g)?.length, seededPlan.weeks.length)
    expect('the 5K page states the length as the number of weeks', page.includes(`${seededPlan.weeks.length} weeks`), true)
    expect('the 5K page links its PDF through /downloads', page.includes(`href="/downloads/${seededPdf.slug}"`), true)
    expect('the 5K page carries Course JSON-LD', /"@type":"Course".*"timeRequired":"P8W"/.test(page), true)

    const download = await get(`/downloads/${seededPdf.slug}`)
    const bytes = Buffer.from(await download.arrayBuffer())
    expect('a published download is served', download.status, 200)
    expect('it is sent as its own type', download.headers.get('content-type'), 'application/pdf')
    expect('it is named after its slug', download.headers.get('content-disposition'), `attachment; filename="${seededPdf.slug}.pdf"`)
    expect('it is the stored file', [bytes.length, bytes.subarray(0, 5).toString('latin1')], [seededPdf.filesize, '%PDF-'])
    expect('shared caches never keep it', download.headers.get('cache-control'), 'private, no-cache')

    expect('an unknown download is 404', (await get(`/downloads/no-such-${run}`)).status, 404)
    expect('a draft download is 404', (await get(`/downloads/${slugs.draftPdf}`)).status, 404)
    expect("Payload's file route refuses anonymous readers", (await get(`/api/resources/file/${seededPdf.filename}`)).status, 404)
    const login = await fetch(new URL('/api/staff/login', site), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: staff.email, password: `pw-${run}-check` }),
    })
    const { token } = (await login.json()) as { token?: string }
    const preview = await fetch(new URL(`/api/resources/file/${seededPdf.filename}`, site), { headers: { authorization: `JWT ${token}` } })
    expect('staff still preview files through it', preview.status, 200)
    expect('the downloads list links through /downloads', (await (await get('/resources')).text()).includes(`/downloads/${seededPdf.slug}`), true)
  } else {
    console.log('SKIP HTTP checks: set ERC_CHECK_URL to the running site')
  }
} finally {
  if (planId !== null) await payload.delete({ collection: 'trainingPlans', id: planId })
  for (const id of createdResources) await payload.delete({ collection: 'resources', id })
  await payload.delete({ collection: 'staff', id: staff.id })
}

console.log(failures.length === 0 ? 'All plan checks passed' : `${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
