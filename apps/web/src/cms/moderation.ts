import type { Moderation } from '@erc/domain'
import type { GroupField, PayloadRequest, Where } from 'payload'

import { staffOf } from './access'
import { optionsFrom, shownWhen } from './fields'

const approved: Where = { 'moderation.state': { equals: 'approved' satisfies Moderation['state'] } }

/** Staff see every row; everyone else sees approved rows only, enforced as a query filter rather than page logic. */
export const approvedUnlessStaff = ({ req }: { req: PayloadRequest }) => (staffOf(req) ? true : approved)

export const moderationField: GroupField = {
  name: 'moderation',
  type: 'group',
  admin: { position: 'sidebar' },
  fields: [
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'submitted' satisfies Moderation['state'],
      options: optionsFrom<Moderation['state']>({ submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }),
    },
    {
      name: 'decidedBy',
      type: 'relationship',
      relationTo: 'staff',
      required: true,
      admin: { condition: shownWhen('state', 'approved', 'rejected') },
    },
    {
      name: 'decidedAt',
      type: 'date',
      required: true,
      admin: { condition: shownWhen('state', 'approved', 'rejected') },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: { condition: shownWhen('state', 'rejected') },
    },
  ],
}
