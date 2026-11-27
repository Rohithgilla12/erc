import { sql } from '@payloadcms/db-postgres/drizzle'
import type { CollectionAfterChangeHook, Payload } from 'payload'

import { endLinks } from '@/members/coaching'
import type { Coach } from '@/payload-types'

import { isAdmin, isStaff } from '../access'
import { slugField } from '../editorial-fields'
import { defineEditorial } from '../kinds'

const memberIdOf = (member: Coach['member']) => (typeof member === 'object' && member !== null ? member.id : (member ?? null))

/**
 * The member account is what reads the coach's athletes' shared intakes and check-ins, so a new account must not
 * inherit them: changing it ends the coach's links, in the save's transaction, and the athletes ask again.
 */
const endLinksOnReassign: CollectionAfterChangeHook<Coach> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || memberIdOf(doc.member) === memberIdOf(previousDoc.member)) return doc
  const transactionID = await req.transactionID
  const db = (transactionID === undefined ? undefined : (req.payload.db.sessions?.[transactionID]?.db as Payload['db']['drizzle'] | undefined)) ?? req.payload.db.drizzle
  await endLinks(db, sql`coach_id = ${doc.id} AND state IN ('requested', 'active')`, 'staff')
  return doc
}

export const Coaches = defineEditorial({
  slug: 'coaches',
  admin: { useAsTitle: 'name' },
  hooks: { afterChange: [endLinksOnReassign] },
  fields: [
    { name: 'name', type: 'text', required: true },
    slugField({ from: 'name' }),
    { name: 'credentials', type: 'textarea', required: true },
    { name: 'photo', type: 'upload', relationTo: 'media' },
    { name: 'bio', type: 'richText', admin: { description: 'Shown on the coach’s public profile.' } },
    {
      name: 'member',
      type: 'relationship',
      relationTo: 'members',
      access: { read: isStaff, create: isAdmin, update: isAdmin },
      admin: {
        position: 'sidebar',
        description: 'The member account that controls this coach profile and views athlete rosters. Only admins can change it, and changing it ends this coach’s coaching links.',
      },
    },
  ],
})
