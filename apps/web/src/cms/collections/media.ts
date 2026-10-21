import type { Payload, PayloadRequest, UploadConfig } from 'payload'

import { defineRecord } from '../kinds'

type UploadHandler = NonNullable<UploadConfig['handlers']>[number]

/**
 * Media is public, so Payload's file route reads any path under its folder without a document lookup, and an encoded
 * `resources%2F<file>` would reach downloads stored beside it, drafts included. Stored names never contain a separator.
 */
const plainFilenamesOnly: UploadHandler = (_req, { params }) => {
  if (/[/\\]/.test(params.filename)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/** Photos members upload carry this prefix, so the code replacing or removing one knows the file is theirs to delete. */
export const MEMBER_PHOTO_PREFIX = 'member-photo-'

/**
 * Deletes a photo a member uploaded once nothing shows it any more: an uploaded file can be opened by anyone who has
 * its address, and the member took it down. Photos staff uploaded stay in the library for staff to manage.
 */
export async function deleteMemberPhoto(payload: Payload, id: number | null, req?: PayloadRequest): Promise<void> {
  if (id === null) return
  const media = await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true, disableErrors: true, ...(req ? { req } : {}) })
  if (media?.filename?.startsWith(MEMBER_PHOTO_PREFIX)) await payload.delete({ collection: 'media', id, overrideAccess: true, ...(req ? { req } : {}) })
}

export const Media = defineRecord({
  slug: 'media',
  visibility: 'public',
  // Without R2, uploads land here; production mounts a host volume at MEDIA_DIR so they survive redeploys.
  upload: { mimeTypes: ['image/*'], staticDir: process.env.MEDIA_DIR ?? 'media', handlers: [plainFilenamesOnly] },
  fields: [{ name: 'alt', type: 'text', required: true }],
})
