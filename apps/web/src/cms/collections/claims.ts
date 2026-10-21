import type { Moderation } from '@erc/domain'
import { sql, type PostgresAdapterArgs } from '@payloadcms/db-postgres'
import { uniqueIndex } from '@payloadcms/db-postgres/drizzle/pg-core'
import { APIError, type CollectionAfterChangeHook } from 'payload'

import type { Claim as ClaimDoc } from '@/payload-types'

import { defineRecord } from '../kinds'

export const idOf = (value: number | { id: number } | null | undefined): number | null => (typeof value === 'object' && value !== null ? value.id : (value ?? null))

const APPROVED: Moderation['state'] = 'approved'

export const becameApproved = (doc: { moderation: { state: string } }, previous: { moderation?: { state: string } } | undefined) =>
  doc.moderation.state === APPROVED && previous?.moderation?.state !== APPROVED

/** Set by the member who asks; staff decide a claim but never rewrite what it says. */
export const askedBy = { access: { update: () => false }, admin: { readOnly: true } }

/**
 * Approving a claim links the member in the same transaction, so a claim is never approved without its link. A profile
 * that has since been linked or withdrawn refuses, and the approval rolls back with it.
 */
const linkOnApproval: CollectionAfterChangeHook<ClaimDoc> = async ({ doc, previousDoc, operation, req }) => {
  if (operation !== 'update' || !becameApproved(doc, previousDoc)) return doc
  const athlete = await req.payload.findByID({ collection: 'athletes', id: idOf(doc.athlete)!, depth: 0, overrideAccess: true, req })
  if (athlete.member != null || athlete.moderation.state !== APPROVED) {
    throw new APIError('This profile already belongs to a member, or is no longer approved, so the claim cannot be approved.', 409, undefined, true)
  }
  await req.payload.update({ collection: 'athletes', id: athlete.id, data: { member: idOf(doc.member) }, depth: 0, overrideAccess: true, req })
  return doc
}

/**
 * A member asking to be linked to a coach-entered athlete profile. Staff approve it to link them; nothing on the
 * profile is copied or changed besides the link.
 */
export const Claims = defineRecord({
  slug: 'claims',
  visibility: 'request',
  labels: { singular: 'Profile claim', plural: 'Profile claims' },
  defaultSort: '-createdAt',
  access: { create: () => false },
  admin: {
    defaultColumns: ['athlete', 'member', 'note', 'moderation.state', 'createdAt'],
    description: 'Members asking to take over an athlete profile a coach entered. Approve to link them: from then on they control the profile and what it shows.',
  },
  hooks: { afterChange: [linkOnApproval] },
  fields: [
    { name: 'member', type: 'relationship', relationTo: 'members', required: true, index: true, ...askedBy },
    { name: 'athlete', type: 'relationship', relationTo: 'athletes', required: true, index: true, ...askedBy },
    { name: 'note', type: 'textarea', required: true, maxLength: 500, ...askedBy, admin: { ...askedBy.admin, description: 'What the member told us to show the profile is theirs.' } },
  ],
})

type SchemaHook = NonNullable<PostgresAdapterArgs['afterSchemaInit']>[number]

const OPEN = sql`moderation_state = 'submitted'`

/**
 * One open claim per profile and one per member, held by the database so two requests at once cannot both get in.
 * Decided claims stay as history and do not count.
 */
export const memberRequestIndexes: SchemaHook = ({ schema, extendTable }) => {
  const claims = schema.tables.claims
  const changes = schema.tables.profile_changes
  if (!claims || !changes) throw new Error('claims or profile_changes missing from the Drizzle schema')
  extendTable({
    table: claims,
    extraConfig: (t) => ({
      claims_open_athlete_idx: uniqueIndex('claims_open_athlete_idx').on(t.athlete).where(OPEN),
      claims_open_member_idx: uniqueIndex('claims_open_member_idx').on(t.member).where(OPEN),
    }),
  })
  extendTable({
    table: changes,
    extraConfig: (t) => ({
      profile_changes_open_field_idx: uniqueIndex('profile_changes_open_field_idx').on(t.athlete, t.field).where(OPEN),
    }),
  })
  return schema
}
