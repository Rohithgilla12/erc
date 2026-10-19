import { decide, mayDecide, type Instant, type Moderation, type ModerationDecision, type ModerationRefusal, type StaffRole } from '@erc/domain'
import { APIError, ValidationError, type CollectionBeforeChangeHook, type Field, type GroupField, type PayloadRequest, type Where } from 'payload'

import { actorOf, staffOf } from './access'
import { optionsFrom, shownWhen } from './fields'

const approved: Where = { 'moderation.state': { equals: 'approved' satisfies Moderation['state'] } }

/** Staff see every row; everyone else sees approved rows only, enforced as a query filter rather than page logic. */
export const approvedUnlessStaff = ({ req }: { req: PayloadRequest }) => (staffOf(req) ? true : approved)

/** Deleting an approved record takes it off the site, which only someone who may decide can do. */
export const moderatedDelete = ({ req }: { req: PayloadRequest }) => {
  const staff = staffOf(req)
  if (!staff) return false
  return mayDecide(staff.role) ? true : { 'moderation.state': { not_equals: 'approved' satisfies Moderation['state'] } }
}

/** Written only by `applyModeration`, so the admin shows it read-only and the hook discards whatever a request sends. */
export const moderationField: GroupField = {
  name: 'moderation',
  type: 'group',
  admin: { position: 'sidebar', readOnly: true },
  fields: [
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'submitted' satisfies Moderation['state'],
      options: optionsFrom<Moderation['state']>({ submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' }),
    },
    {
      name: 'submitter',
      type: 'group',
      admin: { description: 'Who sent a public submission. Empty when staff added the record.' },
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
      ],
    },
    { name: 'submittedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
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
      admin: { condition: shownWhen('state', 'approved', 'rejected'), date: { pickerAppearance: 'dayAndTime' } },
    },
    {
      name: 'reason',
      type: 'textarea',
      required: true,
      admin: { condition: shownWhen('state', 'rejected') },
    },
  ],
}

type DecisionKind = ModerationDecision['kind']

/** The one moderation control: an unstored choice applied by the save that carries it. */
export const decisionFields: Field[] = [
  {
    name: 'moderationDecision',
    label: 'Decision',
    type: 'select',
    virtual: true,
    options: optionsFrom<DecisionKind>({ approve: 'Approve', reject: 'Reject' }),
    admin: {
      position: 'sidebar',
      readOnly: false,
      description: 'Applied when you save.',
      condition: (data, _sibling, { user }) => {
        const role = (user as { role?: StaffRole } | null)?.role
        return Boolean(role && mayDecide(role)) && data.moderation?.state === 'submitted'
      },
    },
  },
  {
    name: 'rejectionReason',
    type: 'textarea',
    virtual: true,
    admin: { position: 'sidebar', readOnly: false, condition: shownWhen('moderationDecision', 'reject') },
  },
]

type StoredModeration = {
  state: Moderation['state']
  submitter?: { name?: string | null; email?: string | null }
  submittedAt?: string | null
  decidedBy?: number | { id: number } | null
  decidedAt?: string | null
  reason?: string | null
}

const decisionOf = (data: Record<string, unknown>): ModerationDecision | null => {
  const decision = data.moderationDecision
  if (decision == null || decision === '') return null
  if (decision === 'approve') return { kind: 'approve' }
  const reason = typeof data.rejectionReason === 'string' ? data.rejectionReason.trim() : ''
  if (decision === 'reject' && reason) return { kind: 'reject', reason }
  throw new ValidationError({
    errors: [
      decision === 'reject'
        ? { message: 'Say why the record is rejected.', path: 'rejectionReason' }
        : { message: 'Choose Approve or Reject.', path: 'moderationDecision' },
    ],
  })
}

/** A public submitter's name and email are claims the submission makes, so they are kept from the create request. */
const submittedNow = (sent: StoredModeration | undefined, now: Instant): StoredModeration => {
  const name = sent?.submitter?.name?.trim()
  const email = sent?.submitter?.email?.trim()
  // A group must stay an object for Payload's field traversal, so an absent submitter is empty fields, not null.
  return { state: 'submitted', submitter: name && email ? { name, email } : { name: null, email: null }, submittedAt: now }
}

const REFUSAL_STATUS: Record<ModerationRefusal, number> = { role_cannot: 403, already_decided: 409 }

/**
 * Owns the moderation group: a create starts as submitted, and only a decision run through `decide()` changes it,
 * stamped with the acting staff member and the clock. Anything a request sends for the group is discarded.
 */
export const applyModeration: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  const { moderationDecision: _decision, rejectionReason: _reason, ...rest } = data
  const now = new Date().toISOString() as Instant
  const stored: StoredModeration =
    operation === 'create' ? submittedNow(data.moderation as StoredModeration | undefined, now) : (originalDoc?.moderation as StoredModeration)
  const decision = decisionOf(data)
  if (!decision) return { ...rest, moderation: stored }
  const result = decide(stored, decision, actorOf(req), now)
  if (!result.ok) throw new APIError(`Moderation refused: ${result.error}`, REFUSAL_STATUS[result.error], undefined, true)
  const decided = result.value
  if (decided.state === 'submitted') throw new APIError('A decision left the record submitted', 500)
  return {
    ...rest,
    moderation: {
      ...stored,
      state: decided.state,
      decidedBy: decided.by,
      decidedAt: decided.at,
      reason: decided.state === 'rejected' ? decided.reason : null,
    },
  }
}
