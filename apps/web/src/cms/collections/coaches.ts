import { slugField } from '../editorial-fields'
import { defineEditorial } from '../kinds'

export const Coaches = defineEditorial({
  slug: 'coaches',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField({ from: 'name' }),
    { name: 'credentials', type: 'textarea', required: true },
    { name: 'photo', type: 'upload', relationTo: 'media' },
    { name: 'bio', type: 'richText', admin: { description: 'Shown on the coach’s public profile.' } },
  ],
})
