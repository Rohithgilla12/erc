/**
 * Proves R2 storage end to end against a running site started with the five R2_* variables:
 * `ERC_CHECK_URL=http://localhost:3000 pnpm payload run src/scripts/check-r2.ts`, with the same R2_* values. It uploads
 * an image and a download, publishes a coach that shows the image, fetches what the public pages point at, then
 * deletes everything it wrote and confirms the bucket objects went with it. It also fetches every file uploaded before
 * this run, so files left on local disk from before the switch show up as failures until they are copied to the bucket.
 */
import config from '@payload-config'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getPayload } from 'payload'
import sharp from 'sharp'

import { minimalPdf } from './fixtures/pdf'

const site = process.env.ERC_CHECK_URL ?? ''
if (!site) throw new Error('Set ERC_CHECK_URL to a running site, such as http://localhost:3000')
const publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '')
if (!publicUrl) throw new Error('Set the five R2_* variables to the values the running site uses')

const payload = await getPayload({ config })
const run = Date.now()
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const fetched = async (url: string) => {
  const response = await fetch(url)
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, type: response.headers.get('content-type')?.split(';')[0] ?? null, bytes }
}

/** Every `<img>` source on the page that names the file, as an absolute URL; `/_next/image` sources resolve against the site. */
const imageSources = (html: string, filename: string) =>
  [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/g)]
    .map((match) => match[1]!.replaceAll('&amp;', '&'))
    .filter((src) => decodeURIComponent(src).includes(filename))
    .map((src) => new URL(src, site).href)

const existingMedia = await payload.find({ collection: 'media', pagination: false, depth: 0 })
const existingResources = await payload.find({ collection: 'resources', pagination: false, depth: 0, where: { _status: { equals: 'published' } } })

const staff = await payload.create({
  collection: 'staff',
  data: { email: `r2-check-${run}@erc.invalid`, password: `pw-${run}-check`, role: 'editor' },
})
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staff, collection: 'staff' as const }
const created = { media: null as number | null, coach: null as number | null, resource: null as number | null }
const objectUrls: string[] = []

try {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#06a' } }).png().toBuffer()
  const media = await payload.create({
    collection: 'media',
    data: { alt: 'R2 check' },
    file: { data: image, mimetype: 'image/png', name: `r2-check-${run}.png`, size: image.length },
  })
  created.media = media.id
  const mediaFilename = media.filename ?? ''
  expect('an uploaded image gets a URL under R2_PUBLIC_URL', media.url, `${publicUrl}/${mediaFilename}`)
  objectUrls.push(media.url ?? '')
  const object = await fetched(media.url ?? '')
  expect('the image is in the bucket, served from the public URL', [object.status, object.type, object.bytes.equals(image)], [200, 'image/png', true])
  expect('the image is not written to local disk', existsSync(path.resolve(process.env.MEDIA_DIR ?? 'media', mediaFilename)), false)

  const coach = await payload.create({
    collection: 'coaches',
    data: { name: `R2 Check Coach ${run}`, slug: `r2-check-coach-${run}`, credentials: 'Check', photo: media.id, _status: 'published' },
    user,
    draft: false,
  })
  created.coach = coach.id
  const page = await fetch(new URL(`/coaches/${coach.slug}`, site))
  const html = await page.text()
  expect("the coach's public page renders", page.status, 200)
  const sources = imageSources(html, mediaFilename)
  expect("the page shows the coach's photo", sources.length > 0, true)
  for (const src of sources) {
    const shown = await fetched(src)
    expect(`the photo loads from ${src}`, [shown.status, shown.type?.startsWith('image/')], [200, true])
  }

  const pdf = minimalPdf(['R2 check'])
  const resource = await payload.create({
    collection: 'resources',
    data: {
      title: `R2 check ${run}`,
      slug: `r2-check-pdf-${run}`,
      description: 'Placeholder: check fixture.',
      category: 'guide',
      access: { kind: 'free' },
      _status: 'published',
    },
    file: { data: pdf, mimetype: 'application/pdf', name: `r2-check-${run}.pdf`, size: pdf.length },
    user,
    draft: false,
  })
  created.resource = resource.id
  expect('a download is stored under the resources prefix', resource.prefix, 'resources')
  const resourceObject = `${publicUrl}/resources/${resource.filename}`
  objectUrls.push(resourceObject)
  expect('the download is in the bucket under resources/', (await fetched(resourceObject)).status, 200)
  const download = await fetched(new URL(`/downloads/${resource.slug}`, site).href)
  expect('/downloads serves it through the site', [download.status, download.type, download.bytes.equals(pdf)], [200, 'application/pdf', true])
  expect("Payload's file route still refuses anonymous readers", (await fetched(new URL(`/api/resources/file/${resource.filename}`, site).href)).status, 404)
} finally {
  if (created.coach !== null) await payload.delete({ collection: 'coaches', id: created.coach })
  if (created.media !== null) await payload.delete({ collection: 'media', id: created.media })
  if (created.resource !== null) await payload.delete({ collection: 'resources', id: created.resource })
  await payload.delete({ collection: 'staff', id: staff.id })
}

for (const url of objectUrls) expect(`deleting the document removes ${url}`, (await fetched(url)).status, 404)

for (const doc of existingMedia.docs) {
  const file = await fetched(doc.url ?? '')
  expect(`media ${doc.id} uploaded earlier loads from ${doc.url}`, [file.status, file.type?.startsWith('image/')], [200, true])
}
for (const doc of existingResources.docs) {
  expect(`download ${doc.slug} uploaded earlier is served`, (await fetched(new URL(`/downloads/${doc.slug}`, site).href)).status, 200)
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('R2 checks passed')
process.exit(0)
