import { parseSlug } from '@erc/domain'
import type { CollectionBeforeChangeHook, Field, TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

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
 * `topic` under `/learn`.
 */
export const slugField = ({ from, reserved }: { from: string; reserved?: (slug: string) => string | null }): TextField => {
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
    admin: { position: 'sidebar', description: `Part of the page address. Left empty, it is made from the ${from}.` },
  }
}

export const seoField: Field = {
  name: 'seo',
  label: 'Search and sharing',
  type: 'group',
  fields: [
    { name: 'title', type: 'text', admin: { description: 'Defaults to the title.' } },
    { name: 'description', type: 'textarea', maxLength: 300, admin: { description: 'Defaults to the excerpt or description.' } },
    { name: 'image', type: 'upload', relationTo: 'media', admin: { description: 'Shown when the page is shared. Defaults to the cover.' } },
    { name: 'noindex', type: 'checkbox', label: 'Hide from search engines', defaultValue: false },
  ],
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
export const stampFirstPublished: CollectionBeforeChangeHook = ({ data, req }) =>
  req.context.editorialSave === 'publish' && !data.publishedAt ? { ...data, publishedAt: new Date().toISOString() } : data
