import { REVIEW_BODY_MAX, REVIEW_TITLE_MAX, type ReviewSubjectKind } from '@erc/domain'
import { sql, type PostgresAdapterArgs } from '@payloadcms/db-postgres'
import { index, uniqueIndex } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { Condition, RelationshipField } from 'payload'

import { isStaff } from '../access'
import { defineRecord } from '../kinds'

import { askedBy } from './claims'

/** Who wrote it is for staff alone: the public sees an approved athlete name or "ERC member", never the member. */
export const writtenBy: RelationshipField = {
  name: 'member',
  type: 'relationship',
  relationTo: 'members',
  required: true,
  index: true,
  access: { read: isStaff, update: () => false },
  admin: { readOnly: true },
}

const about =
  (kind: ReviewSubjectKind): Condition =>
  (data) =>
    (data.subject as { relationTo?: string } | undefined)?.relationTo === kind

/**
 * A member's review of a shoe or a race. Members write through `src/members/reviews.ts`; staff approve or reject here
 * and never rewrite what the member said.
 */
export const Reviews = defineRecord({
  slug: 'reviews',
  visibility: 'moderated',
  labels: { singular: 'Review', plural: 'Reviews' },
  defaultSort: '-createdAt',
  access: { create: () => false },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'subject', 'rating', 'moderation.state', 'createdAt'],
    description: 'Shoe and race reviews from members. Approve to show one on its page. A member who edits an approved review sends it back here.',
  },
  fields: [
    { name: 'subject', type: 'relationship', relationTo: ['shoes', 'races'], required: true, ...askedBy },
    { name: 'subjectKey', type: 'text', required: true, hidden: true },
    writtenBy,
    { name: 'rating', type: 'number', required: true, min: 1, max: 5, ...askedBy },
    { name: 'title', type: 'text', required: true, maxLength: REVIEW_TITLE_MAX, ...askedBy },
    { name: 'body', type: 'textarea', required: true, maxLength: REVIEW_BODY_MAX, ...askedBy },
    { name: 'kmRun', label: 'Kilometres run in them', type: 'number', min: 0, ...askedBy, admin: { ...askedBy.admin, condition: about('shoes') } },
    { name: 'yearRun', label: 'Year run', type: 'number', min: 1950, ...askedBy, admin: { ...askedBy.admin, condition: about('races') } },
  ],
})

type SchemaHook = NonNullable<PostgresAdapterArgs['afterSchemaInit']>[number]

/**
 * One live review per member per subject, held by the database so two requests at once cannot both get in. A rejected
 * review stays as history and does not count, so the member may write again.
 */
export const reviewIndexes: SchemaHook = ({ schema, extendTable }) => {
  const reviews = schema.tables.reviews
  if (!reviews) throw new Error('reviews missing from the Drizzle schema')
  extendTable({
    table: reviews,
    extraConfig: (t) => ({
      reviews_member_subject_idx: uniqueIndex('reviews_member_subject_idx').on(t.member, t.subjectKey).where(sql`moderation_state <> 'rejected'`),
      reviews_approved_subject_idx: index('reviews_approved_subject_idx').on(t.subjectKey).where(sql`moderation_state = 'approved'`),
    }),
  })
  return schema
}
