import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

import config from '@payload-config'
import { RESOURCE_CATEGORIES, type DownloadableResource, type Result } from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { createLocalReq, getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { Resource as ResourceDoc } from '@/payload-types'

import { nonEmpty, parsing, present, publishedFields, type Logger } from './published'

/** The one public URL for a file. Plan pages, the downloads list, and JSON-LD all link here, never to storage. */
export const downloadPath = (resource: Pick<DownloadableResource, 'slug'>) => `/downloads/${resource.slug}`

/** `<slug>.<ext>`: the slug is already safe in a quoted header, and the extension keeps the file openable. */
export const downloadFilename = (resource: Pick<DownloadableResource, 'slug' | 'file'>) =>
  `${resource.slug}${path.extname(resource.file.filename).toLowerCase()}`

export function parseResourceDoc(doc: ResourceDoc): Result<DownloadableResource, string> {
  return parsing(() => {
    const title = nonEmpty(doc.title, 'title')
    const description = nonEmpty(doc.description, 'description')
    return {
      kind: 'resource',
      ...publishedFields(doc, { title, description }),
      title,
      description,
      category: doc.category,
      file: {
        filename: nonEmpty(doc.filename, 'filename'),
        mimeType: nonEmpty(doc.mimeType, 'mimeType'),
        bytes: present(doc.filesize, 'filesize'),
      },
      access: doc.access,
    }
  })
}

export const publicResources = (docs: readonly ResourceDoc[], logger: Logger): DownloadableResource[] =>
  docs.flatMap((doc) => {
    const parsed = parseResourceDoc(doc)
    if (parsed.ok) return [parsed.value]
    logger.error({ resource: doc.id, slug: doc.slug, field: parsed.error }, 'Skipping a download that does not parse')
    return []
  })

/** Anonymous reads only: Payload's read access hides anything unpublished. */
const findPublished = (payload: Payload, slug?: string) =>
  payload.find({
    collection: 'resources',
    overrideAccess: false,
    ...(slug === undefined ? {} : { where: { slug: { equals: slug } }, limit: 1 }),
    depth: 1,
    pagination: false,
  })

const byCategoryThenTitle = (a: DownloadableResource, b: DownloadableResource) =>
  RESOURCE_CATEGORIES.indexOf(a.category) - RESOURCE_CATEGORIES.indexOf(b.category) || a.title.localeCompare(b.title)

// The tag does the real work; the hour bounds staleness from writes that bypass Payload.
const cachedResources = unstable_cache(
  async (): Promise<DownloadableResource[]> => {
    const payload = await getPayload({ config })
    const { docs } = await findPublished(payload)
    return publicResources(docs, payload.logger).sort(byCategoryThenTitle)
  },
  ['resources:all'],
  { tags: [collectionTag('resources')], revalidate: 3600 },
)

/** Every published download, grouped by kind in `RESOURCE_CATEGORIES` order. */
export const getResources = cache(() => cachedResources())

export type Download = {
  resource: DownloadableResource
  /** Reads the stored bytes. Call it only after `canAccess` has allowed the viewer. */
  open: () => Promise<{ body: ReadableStream<Uint8Array>; bytes: number | null }>
}

/**
 * A published download by slug, read uncached so a file replaced a moment ago is the one served, and so made-up
 * slugs add nothing to the cache. Null for unknown, unpublished, or unparseable resources.
 */
export async function findDownload(slug: string): Promise<Download | null> {
  const payload = await getPayload({ config })
  const doc = (await findPublished(payload, slug)).docs[0]
  const resource = doc ? publicResources([doc], payload.logger)[0] : undefined
  return doc && resource ? { resource, open: () => openStoredFile(payload, doc, resource.file.filename) } : null
}

/**
 * Asks the collection's upload handlers for the file, as Payload's own file route does, on an in-process request
 * marked as already authorised. With R2 configured the storage adapter's handler streams the object; without it no
 * handler answers and the file is read from the collection's folder on disk.
 */
async function openStoredFile(payload: Payload, doc: ResourceDoc, filename: string) {
  const { upload } = payload.collections.resources.config
  const req = await createLocalReq({ context: { resourceDownload: true } }, payload)
  for (const handler of upload.handlers ?? []) {
    const response = await handler(req, { doc, params: { collection: 'resources', filename } })
    if (!(response instanceof Response)) continue
    if (!response.ok || !response.body) throw new Error(`Storage answered ${response.status} for resource ${doc.id} (${filename})`)
    const length = Number(response.headers.get('content-length'))
    return { body: response.body, bytes: Number.isFinite(length) && length > 0 ? length : null }
  }
  const directory = path.resolve(upload.staticDir ?? 'resources')
  const filePath = path.resolve(directory, filename)
  if (!filePath.startsWith(directory + path.sep)) throw new Error(`Resource ${doc.id} has an unsafe filename`)
  const { size } = await stat(filePath).catch((error: unknown) => {
    throw new Error(`Resource ${doc.id} is published but its file is missing at ${filePath}`, { cause: error })
  })
  return { body: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, bytes: size }
}
