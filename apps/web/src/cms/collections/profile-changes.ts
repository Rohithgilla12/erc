import type { Moderation, ReviewedField } from '@erc/domain'
import { APIError, type CollectionAfterChangeHook } from 'payload'

import type { ProfileChange as ProfileChangeDoc } from '@/payload-types'

import { optionsFrom, shownWhen } from '../fields'
import { defineRecord } from '../kinds'

import { askedBy, becameApproved, idOf } from './claims'
import { deleteMemberPhoto } from './media'

const REJECTED: Moderation['state'] = 'rejected'

const dataOf = (doc: ProfileChangeDoc) => (doc.field === 'photo' ? { photo: idOf(doc.photo) } : { [doc.field]: doc.text ?? '' })

/**
 * Approving a change writes it to the live profile in the same transaction, and a photo it replaces that the member
 * uploaded is deleted. A refused photo is deleted too: an uploaded file can be opened by anyone with its address, and
 * nobody agreed to show this one.
 */
const decideChange: CollectionAfterChangeHook<ProfileChangeDoc> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update') return doc
  if (becameApproved(doc, previousDoc)) {
    const athlete = await req.payload.findByID({ collection: 'athletes', id: idOf(doc.athlete)!, depth: 0, overrideAccess: true, req })
    if (idOf(athlete.member) !== idOf(doc.member)) {
      throw new APIError('This profile no longer belongs to the member who asked for the change.', 409, undefined, true)
    }
    await req.payload.update({ collection: 'athletes', id: athlete.id, data: dataOf(doc), depth: 0, overrideAccess: true, req })
    if (doc.field === 'photo') await deleteMemberPhoto(req.payload, idOf(athlete.photo), req)
  } else if (doc.moderation.state === REJECTED && previousDoc?.moderation?.state !== REJECTED && doc.field === 'photo' && doc.photo != null) {
    await req.payload.delete({ collection: 'media', id: idOf(doc.photo)!, overrideAccess: true, req })
  }
  return doc
}

/**
 * A member's change to a reviewed field of their approved profile. The live profile keeps its value until staff
 * approve; at most one change per field waits at a time, and a newer edit replaces it.
 */
export const ProfileChanges = defineRecord({
  slug: 'profileChanges',
  visibility: 'request',
  labels: { singular: 'Profile change', plural: 'Profile changes' },
  defaultSort: '-createdAt',
  access: { create: () => false },
  admin: {
    defaultColumns: ['athlete', 'field', 'text', 'moderation.state', 'createdAt'],
    description: 'Names, bios and photos members want on their public profile. Approve to show the new value; the profile keeps the old one until then.',
  },
  hooks: { afterChange: [decideChange] },
  fields: [
    { name: 'member', type: 'relationship', relationTo: 'members', required: true, index: true, ...askedBy },
    { name: 'athlete', type: 'relationship', relationTo: 'athletes', required: true, index: true, ...askedBy },
    {
      name: 'field',
      type: 'select',
      required: true,
      options: optionsFrom<ReviewedField>({ name: 'Name', bio: 'About', photo: 'Photo' }),
      ...askedBy,
    },
    { name: 'text', label: 'New text', type: 'textarea', ...askedBy, admin: { ...askedBy.admin, condition: shownWhen('field', 'name', 'bio') } },
    { name: 'photo', label: 'New photo', type: 'upload', relationTo: 'media', ...askedBy, admin: { ...askedBy.admin, condition: shownWhen('field', 'photo') } },
  ],
})
