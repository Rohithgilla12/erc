import { isReservedPostSlug } from '@erc/domain'

import { publishedAtField, seoField, slugField, stampFirstPublished } from '../editorial-fields'
import { httpsUrlField } from '../fields'
import { defineEditorial } from '../kinds'

export const Posts = defineEditorial({
  slug: 'posts',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'topics', 'authors', 'publishedAt'] },
  defaultSort: '-publishedAt',
  hooks: { beforeChange: [stampFirstPublished] },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title', reserved: (slug) => (isReservedPostSlug(slug) ? `"${slug}" is a route under /learn; choose another slug` : null) }),
    {
      name: 'excerpt',
      type: 'textarea',
      required: true,
      maxLength: 300,
      admin: { description: 'One or two sentences for article lists and search results.' },
    },
    { name: 'cover', type: 'upload', relationTo: 'media' },
    { name: 'topics', type: 'relationship', relationTo: 'topics', hasMany: true, required: true, minRows: 1, admin: { position: 'sidebar' } },
    { name: 'authors', type: 'relationship', relationTo: 'coaches', hasMany: true, required: true, minRows: 1, admin: { position: 'sidebar' } },
    { name: 'body', type: 'richText', required: true },
    {
      name: 'references',
      type: 'array',
      admin: { description: 'Sources for evidence-based claims, listed under the article.' },
      fields: [
        { name: 'title', type: 'text', required: true },
        httpsUrlField('url', { required: true }),
        { name: 'publisher', type: 'text' },
      ],
    },
    {
      name: 'related',
      label: 'Related content',
      type: 'relationship',
      relationTo: ['posts', 'videos'],
      hasMany: true,
      maxRows: 6,
      filterOptions: ({ id, relationTo }) => (relationTo === 'posts' && id ? { id: { not_equals: id } } : true),
    },
    publishedAtField,
    seoField,
  ],
})
