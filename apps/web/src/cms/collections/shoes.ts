import { parseSlug, SHOE_CATEGORIES } from '@erc/domain'
import type { CollectionBeforeDeleteHook, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { labelsOf, optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

const shoeSlug: TextFieldSingleValidation = (value, args) =>
  value && !parseSlug(value).ok ? 'Use lower-case letters and digits joined by single hyphens, such as asics-novablast-5' : text(value, args)

/** Reviews hold their subject in a join table, so deleting the subject alone would leave reviews about nothing. */
export const deleteReviewsOf =
  (kind: 'shoes' | 'races'): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    await req.payload.delete({ collection: 'reviews', where: { subjectKey: { equals: `${kind}:${id}` } }, overrideAccess: true, req })
    if (kind === 'races') await req.payload.delete({ collection: 'questions', where: { race: { equals: id } }, overrideAccess: true, req })
  }

/** Running shoes staff list so members can review them. Everything here is public. */
export const Shoes = defineRecord({
  slug: 'shoes',
  visibility: 'public',
  labels: { singular: 'Shoe', plural: 'Shoes' },
  defaultSort: 'brand',
  admin: { useAsTitle: 'model', defaultColumns: ['brand', 'model', 'category'] },
  hooks: { beforeDelete: [deleteReviewsOf('shoes')] },
  fields: [
    { name: 'brand', type: 'text', required: true, maxLength: 60 },
    { name: 'model', type: 'text', required: true, maxLength: 80 },
    { name: 'slug', type: 'text', required: true, unique: true, validate: shoeSlug },
    { name: 'category', type: 'select', required: true, index: true, options: optionsFrom(labelsOf(SHOE_CATEGORIES)) },
    { name: 'description', type: 'textarea', required: true, maxLength: 1000, admin: { description: 'Plain facts: what the shoe is for and how it is built. No prices.' } },
    { name: 'image', type: 'upload', relationTo: 'media' },
  ],
})
