import { slugField } from '../editorial-fields'
import { defineEditorial } from '../kinds'

export const Topics = defineEditorial({
  slug: 'topics',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'order', 'slug'] },
  defaultSort: 'order',
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title' }),
    { name: 'description', type: 'textarea', required: true, admin: { description: 'One or two sentences shown on the topic page and in search results.' } },
    { name: 'order', type: 'number', required: true, defaultValue: 0, admin: { position: 'sidebar', description: 'Lower numbers come first in the learning centre.' } },
  ],
})
