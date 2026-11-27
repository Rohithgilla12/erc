import { slugField } from '../editorial-fields'
import { httpsUrlField, localDateField } from '../fields'
import { defineEditorial } from '../kinds'

/** Staff-curated pointers to running news elsewhere: a headline and a summary in the club's words, and the source. */
export const News = defineEditorial({
  slug: 'news',
  labels: { singular: 'News item', plural: 'News' },
  admin: { useAsTitle: 'headline', defaultColumns: ['headline', 'sourceName', 'publishedOn'] },
  defaultSort: '-publishedOn',
  fields: [
    { name: 'headline', type: 'text', required: true, maxLength: 120 },
    slugField({ from: 'headline' }),
    {
      name: 'summary',
      type: 'textarea',
      required: true,
      maxLength: 280,
      admin: { description: 'What happened and why a club runner should care, in your own words. Up to 280 characters.' },
    },
    httpsUrlField('sourceUrl', { required: true }),
    { name: 'sourceName', type: 'text', required: true, admin: { description: 'Who published it, such as the organiser or a newspaper.' } },
    {
      name: 'relatedRace',
      type: 'relationship',
      relationTo: 'races',
      admin: { position: 'sidebar', description: 'Optional. The race this item is about.' },
    },
    localDateField('publishedOn', { required: true, index: true }),
  ],
})
