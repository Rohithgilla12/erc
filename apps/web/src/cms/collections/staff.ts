import type { StaffRole } from '@erc/domain'
import { APIError, type CollectionBeforeDeleteHook } from 'payload'

import { isAdmin, isAdminOrSelf } from '../access'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

/**
 * The foreign keys from races to staff set null on delete, and a race with no confirming coach or no decider no
 * longer parses, so it would vanish from the site. Refuse instead, and say what to fix.
 */
const keepRaceProvenance: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const { totalDocs } = await req.payload.count({
    collection: 'races',
    where: { or: [{ 'source.confirmedBy': { equals: id } }, { 'moderation.decidedBy': { equals: id } }] },
    req,
  })
  if (totalDocs > 0) {
    throw new APIError(
      `This staff member confirmed or moderated ${totalDocs} race(s). Reassign them before deleting the account.`,
      409,
      { races: totalDocs },
      true,
    )
  }
}

export const Staff = defineRecord({
  slug: 'staff',
  visibility: 'private',
  auth: true,
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'role'] },
  access: { create: isAdmin, delete: isAdmin, update: isAdminOrSelf },
  hooks: { beforeDelete: [keepRaceProvenance] },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      saveToJWT: true,
      options: optionsFrom<StaffRole>({ admin: 'Admin', editor: 'Editor', author: 'Author' }),
      // Without this an author could promote themselves through their own profile.
      access: { update: isAdmin },
    },
  ],
})
