import { defineRecord } from '../kinds'

export const Media = defineRecord({
  slug: 'media',
  visibility: 'public',
  // Without R2, uploads land here; production mounts a host volume at MEDIA_DIR so they survive redeploys.
  upload: { mimeTypes: ['image/*'], staticDir: process.env.MEDIA_DIR ?? 'media' },
  fields: [{ name: 'alt', type: 'text', required: true }],
})
