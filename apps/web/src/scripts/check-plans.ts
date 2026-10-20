/**
 * Proves the plan and download rules against a migrated, seeded database:
 * `pnpm payload run src/scripts/check-plans.ts` after `seed-plans.ts`. With `ERC_CHECK_URL=<site>` it also checks the
 * pages and `/downloads` over HTTP; the site must share this database and `REVALIDATE_SECRET`. Everything it writes
 * is removed.
 */
import config from '@payload-config'
import { getPayload } from 'payload'
import sharp from 'sharp'

import { pageBySlug } from '@/content/pages'
import { publishedPlans } from '@/content/plans'
import { parseResourceDoc } from '@/content/resources'
import { siteConfig } from '@/site-config'

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
const createdPlans: number[] = []
const created = { media: null as number | null, coach: null as number | null, page: null as number | null }
const restore: (() => Promise<unknown>)[] = []

try {
  const draftPdf = await payload.create({ collection: 'resources', data: { ...resourceData, slug: slugs.draftPdf }, file: pdfFile, user, draft: true })
  createdResources.push(draftPdf.id)
  expect('anonymous readers cannot list a draft download', await anonymousSlugs('resources', slugs.draftPdf), [])
  expect('a stored file gets a random name, not its upload name', /^[0-9a-f-]{36}\.pdf$/.test(draftPdf.filename ?? ''), true)

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
  createdPlans.push(plan.id)
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
    expect(
      "the media route cannot reach a draft's file in the folder beside it",
      (await get(`/api/media/file/resources%2F${draftPdf.filename}`)).status,
      404,
    )
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

  await localMediaCases(seededPlan)
} finally {
  for (const undo of restore) await undo()
  for (const id of createdPlans) await payload.delete({ collection: 'trainingPlans', id })
  if (created.page !== null) await payload.delete({ collection: 'pages', id: created.page })
  if (created.coach !== null) await payload.delete({ collection: 'coaches', id: created.coach })
  if (created.media !== null) await payload.delete({ collection: 'media', id: created.media })
  for (const id of createdResources) await payload.delete({ collection: 'resources', id })
  await payload.delete({ collection: 'staff', id: staff.id })
}

/**
 * Without R2, Payload gives uploads a path on this site rather than an https URL. Every image a page shows must still
 * resolve to the site's own address: coach photos on plans and page coach grids, and plan, resource, and page SEO images.
 */
async function localMediaCases(template: NonNullable<typeof seededPlan>) {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#0a6' } }).png().toBuffer()
  const media = await payload.create({
    collection: 'media',
    data: { alt: 'Plans check' },
    file: { data: image, mimetype: 'image/png', name: `plans-check-${run}.png`, size: image.length },
  })
  created.media = media.id
  const imageUrl = `${siteConfig().siteUrl.origin}/api/media/file/${media.filename}`
  expect('without R2 an upload has a path on this site', media.url, `/api/media/file/${media.filename}`)

  const coach = await payload.create({
    collection: 'coaches',
    data: { name: `Plans Check Coach ${run}`, slug: `plans-check-coach-${run}`, credentials: 'Check', photo: media.id, _status: 'published' },
    user,
    draft: false,
  })
  created.coach = coach.id
  const weeks: typeof template.weeks = JSON.parse(JSON.stringify(template.weeks, (key, value) => (key === 'id' ? undefined : value)))
  const plan = await payload.create({
    collection: 'trainingPlans',
    data: {
      title: `Check media plan ${run}`,
      slug: `check-media-plan-${run}`,
      goal: template.goal,
      level: template.level,
      prerequisites: template.prerequisites,
      audience: template.audience,
      overview: template.overview,
      weeks,
      access: template.access,
      coaches: [coach.id],
      pdf: null,
      seo: { image: media.id },
      _status: 'published',
    },
    user,
    draft: false,
  })
  createdPlans.push(plan.id)
  const parsedPlan = (await publishedPlans(payload)).find((published) => published.slug === plan.slug)
  expect("a plan's coach photo and SEO image resolve to this site", [parsedPlan?.coaches.map((c) => c.photoUrl), parsedPlan?.seo.imageUrl], [[imageUrl], imageUrl])

  const pdf = minimalPdf(['Media check'])
  const resource = await payload.create({
    collection: 'resources',
    data: { ...resourceData, slug: `check-media-pdf-${run}`, seo: { image: media.id }, _status: 'published' },
    file: { ...pdfFile, data: pdf, size: pdf.length, name: `check-media-${run}.pdf` },
    user,
    draft: false,
  })
  createdResources.push(resource.id)
  const resourceDoc = (await payload.find({ collection: 'resources', overrideAccess: false, depth: 1, where: { id: { equals: resource.id } } })).docs[0]
  const parsedResource = resourceDoc ? parseResourceDoc(resourceDoc) : null
  expect("a resource's SEO image resolves to this site", parsedResource?.ok ? parsedResource.value.seo.imageUrl : parsedResource, imageUrl)

  const page = await payload.create({
    collection: 'pages',
    data: {
      title: `Check page ${run}`,
      slug: `check-page-${run}`,
      seo: { image: media.id },
      layout: [{ blockType: 'coachGrid', coaches: [coach.id] }],
      _status: 'published',
    },
    user,
    draft: false,
  })
  created.page = page.id
  const parsedPage = await pageBySlug(payload, page.slug)
  const grid = parsedPage?.blocks.find((block) => block.kind === 'coachGrid')
  expect(
    "a page's coach grid photo and SEO image resolve to this site",
    [grid?.kind === 'coachGrid' ? grid.coaches.map((c) => c.photoUrl) : null, parsedPage?.seo.imageUrl],
    [[imageUrl], imageUrl],
  )

  if (!site) return
  const planPage = await (await get(`/plans/${plan.slug}`)).text()
  expect('the plan page shares its SEO image', planPage.includes(`<meta property="og:image" content="${imageUrl}"/>`), true)

  // Only routed slugs have a page, so the seeded Coaching page's first coach borrows the photo until the check ends.
  const coaching = await pageBySlug(payload, 'coaching')
  const seededGrid = coaching?.blocks.find((block) => block.kind === 'coachGrid')
  const shown = seededGrid?.kind === 'coachGrid' ? seededGrid.coaches[0] : undefined
  if (!shown) throw new Error('Run seed-learn.ts and seed-pages.ts first: the Coaching page needs a coach grid')
  const before = await payload.findByID({ collection: 'coaches', id: shown.id, depth: 0 })
  restore.push(() => payload.update({ collection: 'coaches', id: shown.id, data: { photo: before.photo ?? null, _status: 'published' }, user, draft: false }))
  await payload.update({ collection: 'coaches', id: shown.id, data: { photo: media.id, _status: 'published' }, user, draft: false })
  const coachingPage = await (await get('/coaching')).text()
  expect('the Coaching page shows the coach photo from local storage', coachingPage.includes(`src="${imageUrl}"`), true)
}

console.log(failures.length === 0 ? 'All plan checks passed' : `${failures.length} failed: ${failures.join('; ')}`)
process.exit(failures.length === 0 ? 0 : 1)
