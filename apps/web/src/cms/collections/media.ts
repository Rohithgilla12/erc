import { defineRecord } from '../kinds'

export const Media = defineRecord({
  slug: 'media',
  visibility: 'public',
  upload: { mimeTypes: ['image/*'] },
  fields: [{ name: 'alt', type: 'text', required: true }],
})
