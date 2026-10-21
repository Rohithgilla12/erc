import { sql } from '@payloadcms/db-postgres/drizzle'
import type { MemberStatus } from '@erc/domain'
import type { CollectionAfterChangeHook } from 'payload'

import { isAdmin } from '../access'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

const STATUS_LABELS: Record<MemberStatus, string> = { active: 'Active', suspended: 'Suspended' }

/** Suspending ends every session at once; `resolveSession` also refuses a suspended member, so this only tidies rows. */
const endSessionsOnSuspend: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (doc.status === 'suspended' && previousDoc?.status !== 'suspended') {
    await req.payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE member_id = ${doc.id}`)
  }
  return doc
}

const setBySignIn = { access: { update: () => false }, admin: { readOnly: true } }
const dayAndTime = { date: { pickerAppearance: 'dayAndTime' as const } }

/**
 * People who sign in to log their running. Never Payload users: sessions live in `member_sessions`, so Payload auth
 * stays staff-only. Only sign-in writes a row; staff may read it and change `status`.
 */
export const Members = defineRecord({
  slug: 'members',
  visibility: 'private',
  labels: { singular: 'Member', plural: 'Members' },
  defaultSort: '-createdAt',
  access: { create: () => false, delete: isAdmin },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'status', 'lastSignInAt', 'createdAt'],
    description: 'People who sign in to the site. Accounts are created by signing in, never here. Suspend a member to sign them out everywhere and refuse new sign-ins.',
  },
  hooks: { afterChange: [endSessionsOnSuspend] },
  fields: [
    { name: 'email', type: 'email', required: true, unique: true, index: true, ...setBySignIn },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active' satisfies MemberStatus,
      options: optionsFrom(STATUS_LABELS),
      index: true,
      admin: { position: 'sidebar', description: 'Suspended members are signed out and cannot sign in again until reactivated.' },
    },
    {
      name: 'ageDeclaredAt',
      label: 'Declared 18 or over',
      type: 'date',
      required: true,
      ...setBySignIn,
      admin: { ...setBySignIn.admin, ...dayAndTime, description: 'When they confirmed they are 18 or over, on their first sign-in.' },
    },
    { name: 'lastSignInAt', label: 'Last signed in', type: 'date', ...setBySignIn, admin: { ...setBySignIn.admin, ...dayAndTime } },
  ],
})
