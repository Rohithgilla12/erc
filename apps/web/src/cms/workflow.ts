import { transition, type EditorialState, type Instant, type StaffId, type WorkflowAction } from '@erc/domain'
import { APIError, Forbidden, type CollectionBeforeChangeHook, type JSONField, type PayloadRequest, type Where } from 'payload'

import { staffOf } from './access'

declare module 'payload' {
  interface RequestContext {
    /** The only way to change editorial state: a caller asks for an action and the hook runs the domain state machine. */
    workflowAction?: WorkflowAction
  }
}

const DRAFT: EditorialState = { kind: 'draft' }

export const payloadStatusOf = (state: EditorialState): 'draft' | 'published' =>
  state.kind === 'published' ? 'published' : 'draft'

const published: Where = { _status: { equals: 'published' } }

export const publishedUnlessStaff = ({ req }: { req: PayloadRequest }) => (staffOf(req) ? true : published)

export const workflowField: JSONField = {
  name: 'workflow',
  type: 'json',
  required: true,
  defaultValue: DRAFT,
  admin: { position: 'sidebar', readOnly: true },
}

/**
 * Overwrites whatever the request sent for `workflow`, so no client can set editorial state directly,
 * and derives `_status` from the result so the two can never disagree.
 */
export const applyWorkflow: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  const current = (originalDoc?.workflow as EditorialState | undefined) ?? DRAFT
  const action = req.context.workflowAction
  const next = action ? transitionAs(req, current, action) : current
  return { ...data, workflow: next, _status: payloadStatusOf(next) }
}

function transitionAs(req: PayloadRequest, current: EditorialState, action: WorkflowAction): EditorialState {
  const staff = staffOf(req)
  if (!staff) throw new Forbidden(req.t)
  const actor = { id: staff.id as StaffId, role: staff.role }
  const result = transition(current, action, actor, new Date().toISOString() as Instant)
  if (!result.ok) throw new APIError(`Workflow refused: ${result.error.kind}`, 409, result.error, true)
  return result.value
}
