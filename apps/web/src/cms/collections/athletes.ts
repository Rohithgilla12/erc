import { parseSlug, todayIn, type Athlete } from '@erc/domain'
import type { CollectionBeforeDeleteHook, NumberFieldSingleValidation, SelectField, TextFieldSingleValidation } from 'payload'
import { number, text } from 'payload/shared'

import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'
import { subdivisionOptions } from '../subdivisions'

type Visibility = Athlete['visibility']['profile']

const HIDDEN: Visibility = 'hidden'

const visibilityField = (name: keyof Athlete['visibility'], label: string): SelectField => ({
  name,
  label,
  type: 'select',
  required: true,
  defaultValue: HIDDEN,
  options: optionsFrom<Visibility>({ hidden: 'Hidden', public: 'Public' }),
})

const athleteSlug: TextFieldSingleValidation = (value, args) => {
  if (value && !parseSlug(value).ok) return 'Use lower-case letters and digits joined by single hyphens, such as priya-reddy'
  return text(value, args)
}

const runningSince: NumberFieldSingleValidation = (value, args) => {
  const thisYear = Number(todayIn('Asia/Kolkata').slice(0, 4))
  if (typeof value === 'number' && (!Number.isInteger(value) || value > thisYear)) return `Use a year no later than ${thisYear}`
  return number(value, args)
}

/**
 * Results cannot outlive their athlete, and a removed athlete's results must not linger anywhere. Deleting the athlete
 * was already authorised, so its results go with it in the same transaction.
 */
const deleteResultsWithAthlete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await req.payload.delete({ collection: 'results', where: { athlete: { equals: id } }, overrideAccess: true, req })
}

export const Athletes = defineRecord({
  slug: 'athletes',
  visibility: 'moderated',
  publicWhere: { 'visibility.profile': { equals: 'public' satisfies Visibility } },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'home.subdivision', 'visibility.profile', 'visibility.results', 'moderation.state'],
  },
  defaultSort: 'name',
  hooks: { beforeDelete: [deleteResultsWithAthlete] },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, validate: athleteSlug },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'Uploaded images and their alt text are public, even while this profile is hidden. Add a photo only once the athlete agrees, and leave their name out of the alt text.',
      },
    },
    { name: 'bio', type: 'textarea', maxLength: 400 },
    {
      name: 'home',
      type: 'group',
      fields: [
        { name: 'city', type: 'text' },
        { name: 'subdivision', label: 'State', type: 'select', required: true, index: true, options: subdivisionOptions },
      ],
    },
    { name: 'runningSince', label: 'Running since (year)', type: 'number', min: 1950, validate: runningSince },
    {
      name: 'visibility',
      type: 'group',
      admin: { description: 'The athlete decides. Both stay hidden until they agree to show them.' },
      fields: [visibilityField('profile', 'Profile'), visibilityField('results', 'Results and personal bests')],
    },
  ],
})
