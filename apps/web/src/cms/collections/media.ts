import type { UploadConfig } from 'payload'

import { defineRecord } from '../kinds'

type UploadHandler = NonNullable<UploadConfig['handlers']>[number]

/**
 * Media is public, so Payload's file route reads any path under its folder without a document lookup, and an encoded
 * `resources%2F<file>` would reach downloads stored beside it, drafts included. Stored names never contain a separator.
 */
const plainFilenamesOnly: UploadHandler = (_req, { params }) => {
  if (/[/\\]/.test(params.filename)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

export const Media = defineRecord({
  slug: 'media',
  visibility: 'public',
  // Without R2, uploads land here; production mounts a host volume at MEDIA_DIR so they survive redeploys.
  upload: { mimeTypes: ['image/*'], staticDir: process.env.MEDIA_DIR ?? 'media', handlers: [plainFilenamesOnly] },
  fields: [{ name: 'alt', type: 'text', required: true }],
})
