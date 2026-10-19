import { defineEditorial } from '../kinds'

export const Coaches = defineEditorial({
  slug: 'coaches',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'credentials', type: 'textarea', required: true },
    { name: 'photo', type: 'upload', relationTo: 'media' },
  ],
})
