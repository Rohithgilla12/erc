import { parseSlug, type AccessTier } from '@erc/domain'
import type { CollectionBeforeChangeHook, Field, TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { optionsFrom } from './fields'

const slugify = (title: unknown) =>
  typeof title === 'string'
    ? title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    : undefined

/**
 * A URL slug, filled from `from` when left empty. `reserved` names route segments the slug would shadow, such as
 * `topic` under `/learn`. `description` replaces the admin hint where the slug means more than an address.
 */
export const slugField = ({
  from,
  reserved,
  description,
}: {
  from: string
  reserved?: (slug: string) => string | null
  description?: string
}): TextField => {
  const validate: TextFieldSingleValidation = (value, args) => {
    if (value && !parseSlug(value).ok) return 'Use lower-case letters and digits joined by single hyphens, such as zone-2-basics'
    const clash = value ? reserved?.(value) : null
    return clash ?? text(value, args)
  }
  return {
    name: 'slug',
    type: 'text',
    required: true,
    unique: true,
    validate,
    hooks: { beforeValidate: [({ value, data }) => value || slugify(data?.[from])] },
    admin: {
      position: 'sidebar',
      description: description ?? `Part of the page address. Left empty, it is made from the ${from}. Changing it breaks shared links.`,
    },
  }
}

/** Empty fields fall back to the document's own title, summary and image when the page renders. */
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
      admin: { description: 'Shown under the link in search results. Leave empty to use the excerpt or description.' },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Shown when the page is shared. Defaults to the cover image, or a video’s thumbnail.' },
    },
    { name: 'noindex', type: 'checkbox', label: 'Hide from search engines', defaultValue: false },
  ],
}

const ACCESS_LABELS: Record<AccessTier['kind'], string> = { free: 'Free' }

/** Stored as a group with a `kind`, so Phase 3 adds `paid` and its product as one more variant of the same union. */
export const accessField: Field = {
  name: 'access',
  type: 'group',
  admin: { position: 'sidebar' },
  fields: [{ name: 'kind', label: 'Access', type: 'select', required: true, defaultValue: 'free', options: optionsFrom(ACCESS_LABELS) }],
}

export const publishedAtField: Field = {
  name: 'publishedAt',
  label: 'First published',
  type: 'date',
  admin: {
    position: 'sidebar',
    date: { pickerAppearance: 'dayAndTime' },
    description: 'Set when first published. Change it only to backdate content that appeared elsewhere first.',
  },
}

/**
 * Stamps the first publication time. The workflow's `live.at` moves on every republish, so it is the "updated" date,
 * and the first date has to be kept separately.
 */
export const stampFirstPublished: CollectionBeforeChangeHook = ({ data, originalDoc, req }) =>
  req.context.editorialSave === 'publish' && !(data.publishedAt ?? originalDoc?.publishedAt)
    ? { ...data, publishedAt: new Date().toISOString() }
    : data
