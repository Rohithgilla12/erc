import { parseSlug, PROFILE_FIELDS, todayIn, type LeaderboardStanding, type ProfileField, type ProfileRule, type Visibility, type VisibilityKey } from '@erc/domain'
import type { CollectionBeforeDeleteHook, FieldAccess, NumberFieldSingleValidation, SelectField, TextFieldSingleValidation } from 'payload'
import { number, text } from 'payload/shared'

import { isStaff } from '../access'
import { deleteMemberPhoto } from './media'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'
import { subdivisionOptions } from '../subdivisions'

const HIDDEN: Visibility = 'hidden'

const nobody = () => false

/**
 * Field access for each profile rule. Direct and reviewed fields read and write as any athlete field does; a member
 * writes them through `src/members`, never through Payload. A private field is read and written by no one through
 * Payload, staff included, so it can reach no page, no REST reply and no admin screen.
 */
const ACCESS_BY_RULE: Record<ProfileRule, { access?: { read: FieldAccess; create: FieldAccess; update: FieldAccess } }> = {
  direct: {},
  reviewed: {},
  private: { access: { read: nobody, create: nobody, update: nobody } },
}

const ruledBy = (field: ProfileField) => ACCESS_BY_RULE[PROFILE_FIELDS[field].rule]

const memberOf = (doc: unknown) => (doc as { member?: unknown } | undefined)?.member ?? null

/** Consent has one owner: staff set visibility on a coach-entered profile, and only until a member is linked to it. */
const unlinked: FieldAccess = ({ doc }) => memberOf(doc) === null

const visibilityField = (name: VisibilityKey, label: string): SelectField => ({
  name,
  label,
  type: 'select',
  required: true,
  defaultValue: HIDDEN,
  access: { update: unlinked },
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
 * Results, claims and profile changes cannot outlive their athlete, and a removed athlete's results must not linger
 * anywhere. Deleting the athlete was already authorised, so they go with it in the same transaction.
 */
const deleteRecordsWithAthlete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  // Member photos sit at public addresses; once nothing points at them they must go too.
  const athlete = await req.payload.findByID({ collection: 'athletes', id, depth: 0, overrideAccess: true, disableErrors: true, req })
  const { docs: pending } = await req.payload.find({ collection: 'profileChanges', where: { athlete: { equals: id } }, depth: 0, pagination: false, overrideAccess: true, req })
  for (const photo of [athlete?.photo, ...pending.map((change) => change.photo)]) {
    if (typeof photo === 'number') await deleteMemberPhoto(req.payload, photo, req)
  }
  for (const collection of ['results', 'claims', 'profileChanges'] as const) {
    await req.payload.delete({ collection, where: { athlete: { equals: id } }, overrideAccess: true, req })
  }
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
  hooks: { beforeDelete: [deleteRecordsWithAthlete] },
  fields: [
    { name: 'name', type: 'text', required: true, ...ruledBy('name') },
    { name: 'slug', type: 'text', required: true, unique: true, validate: athleteSlug },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      unique: true,
      // Who owns a profile is never public; only staff read it, and only an approved claim or a member's own start sets it.
      access: { read: isStaff, create: nobody, update: nobody },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description: 'The member who controls this profile, set when staff approve their claim or when they start it themselves.',
      },
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
      ...ruledBy('photo'),
      admin: {
        description: 'An uploaded image can be opened by anyone who has its address, even while this profile is hidden. Add a photo only once the athlete agrees.',
      },
    },
    { name: 'bio', type: 'textarea', maxLength: 400, ...ruledBy('bio') },
    {
      name: 'home',
      type: 'group',
      fields: [
        { name: 'city', type: 'text', ...ruledBy('city') },
        { name: 'subdivision', label: 'State', type: 'select', required: true, index: true, options: subdivisionOptions, ...ruledBy('state') },
      ],
    },
    { name: 'runningSince', label: 'Running since (year)', type: 'number', min: 1950, validate: runningSince, ...ruledBy('runningSince') },
    { name: 'birthYear', type: 'number', ...ruledBy('birthYear') },
    {
      name: 'visibility',
      type: 'group',
      admin: { description: 'The athlete decides. Everything stays hidden until they agree to show it, and once a member is linked only they can change it.' },
      fields: [visibilityField('profile', 'Profile'), visibilityField('results', 'Results and personal bests'), visibilityField('mileage', 'Mileage')],
    },
    {
      name: 'leaderboards',
      type: 'select',
      required: true,
      defaultValue: 'included' satisfies LeaderboardStanding,
      options: optionsFrom<LeaderboardStanding>({ included: 'Included', withheld: 'Withheld' }),
      access: { read: isStaff },
      admin: { position: 'sidebar', description: 'Withheld keeps this athlete off every leaderboard, whatever they choose to show.' },
    },
  ],
})
