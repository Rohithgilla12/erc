import { parseSlug, type AccessTier } from '@erc/domain'
import type { Field, TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { optionsFrom } from './fields'

const slugValidate: TextFieldSingleValidation = (value, args) =>
  value && !parseSlug(value).ok ? 'Use lower-case letters and digits joined by single hyphens, such as beginner-5k' : text(value, args)

export const slugField: TextField = {
  name: 'slug',
  type: 'text',
  required: true,
  unique: true,
  index: true,
  validate: slugValidate,
  admin: { position: 'sidebar', description: 'The last part of the page address. Changing it breaks shared links.' },
}

const ACCESS_LABELS: Record<AccessTier['kind'], string> = { free: 'Free' }

/** Stored as a group with a `kind`, so Phase 3 adds `paid` and its product as one more variant of the same union. */
export const accessField: Field = {
  name: 'access',
  type: 'group',
  admin: { position: 'sidebar' },
  fields: [
    {
      name: 'kind',
      label: 'Access',
      type: 'select',
      required: true,
      defaultValue: 'free',
      options: optionsFrom(ACCESS_LABELS),
    },
  ],
}

/** Empty fields fall back to the document's own title and description when the page renders. */
export const seoField: Field = {
  name: 'seo',
  label: 'Search and sharing',
  type: 'group',
  fields: [
    { name: 'title', type: 'text', maxLength: 70, admin: { description: 'Leave empty to use the title.' } },
    {
      name: 'description',
      type: 'textarea',
      maxLength: 160,
      admin: { description: 'Shown under the link in search results. Leave empty to use a summary.' },
    },
    { name: 'image', type: 'upload', relationTo: 'media' },
    { name: 'noindex', label: 'Hide from search engines', type: 'checkbox', defaultValue: false },
  ],
}
