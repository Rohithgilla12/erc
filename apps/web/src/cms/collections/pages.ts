import { parseLinkHref } from '@erc/domain'
import type { Block, Field, GroupField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

import { seoField, slugField } from '../editorial-fields'
import { defineEditorial } from '../kinds'

const linkGroup = (name: string, label: string, required: boolean): GroupField => {
  const pairedWith =
    (other: 'label' | 'href', missing: string): TextFieldSingleValidation =>
    (value, args) => {
      const base = text(value, args)
      if (base !== true) return base
      const sibling = (args.siblingData as Partial<Record<'label' | 'href', string | null>>)[other]
      return value || !sibling ? true : missing
    }
  const href: TextFieldSingleValidation = (value, args) => {
    const paired = pairedWith('label', 'Add where the button goes.')(value, args)
    if (paired !== true || !value) return paired
    return parseLinkHref(value).ok || 'Use a path on this site such as /races, or a full https:// link.'
  }
  return {
    name,
    label,
    type: 'group',
    fields: [
      { name: 'label', type: 'text', required, validate: pairedWith('href', 'Add the button text.') },
      {
        name: 'href',
        label: 'Link',
        type: 'text',
        required,
        validate: href,
        admin: { description: 'A path on this site such as /races or /contact?topic=coaching, or a full https:// link.' },
      },
    ],
  }
}

const optionalHeading: Field = { name: 'heading', type: 'text' }

const hero: Block = {
  slug: 'hero',
  labels: { singular: 'Hero', plural: 'Heroes' },
  fields: [
    { name: 'heading', type: 'text', required: true, admin: { description: 'The main heading of the page when this block comes first.' } },
    { name: 'body', type: 'textarea' },
    linkGroup('primary', 'Main button', false),
    linkGroup('secondary', 'Second button', false),
  ],
}

const richText: Block = {
  slug: 'richText',
  labels: { singular: 'Text', plural: 'Text' },
  fields: [{ name: 'body', type: 'richText', required: true }],
}

/** A section listing the first few of something the site already orders; the editor picks the heading and how many. */
const listingBlock = ({ slug, label, countHint }: { slug: string; label: string; countHint: string }): Block => ({
  slug,
  labels: { singular: label, plural: label },
  fields: [
    { name: 'heading', type: 'text', required: true, defaultValue: label },
    {
      name: 'count',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      max: 12,
      admin: { step: 1, description: countHint },
    },
  ],
})

const featuredRaces = listingBlock({ slug: 'featuredRaces', label: 'Upcoming races', countHint: 'How many approved races to show, soonest first.' })

const latestPosts = listingBlock({ slug: 'latestPosts', label: 'Latest articles', countHint: 'How many published articles to show, newest first.' })

const featuredPlans = listingBlock({
  slug: 'featuredPlans',
  label: 'Training plans',
  countHint: 'How many published plans to show, in the order of the plans page.',
})
const callToAction: Block = {
  slug: 'callToAction',
  labels: { singular: 'Call to action', plural: 'Calls to action' },
  fields: [{ name: 'heading', type: 'text', required: true }, { name: 'body', type: 'textarea' }, linkGroup('link', 'Button', true)],
}

const coachGrid: Block = {
  slug: 'coachGrid',
  labels: { singular: 'Coaches', plural: 'Coaches' },
  fields: [
    optionalHeading,
    {
      name: 'coaches',
      type: 'relationship',
      relationTo: 'coaches',
      hasMany: true,
      required: true,
      admin: { description: 'Shown in this order. Unpublished coaches are left out on the site.' },
    },
  ],
}

const faq: Block = {
  slug: 'faq',
  labels: { singular: 'Questions and answers', plural: 'Questions and answers' },
  fields: [
    optionalHeading,
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'question', type: 'text', required: true },
        { name: 'answer', type: 'richText', required: true },
      ],
    },
  ],
}

export const Pages = defineEditorial({
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
    description: 'Home, About, Coaching and Contact. Until a page is published, the site shows a built-in version of it.',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title', description: 'home is the front page; about, coaching and contact have their own addresses.' }),
    seoField,
    {
      name: 'layout',
      type: 'blocks',
      required: true,
      minRows: 1,
      blocks: [hero, richText, featuredRaces, latestPosts, featuredPlans, callToAction, coachGrid, faq],
    },
  ],
})
