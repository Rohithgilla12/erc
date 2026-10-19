import type { StaffId, StaffRole } from './moderation'
import { notImplemented, type Instant, type Result } from './primitives'

export type EditorialState =
  | { kind: 'draft' }
  | { kind: 'in_review'; submittedBy: StaffId; at: Instant }
  | { kind: 'changes_requested'; by: StaffId; note: string; at: Instant }
  | { kind: 'scheduled'; publishAt: Instant; by: StaffId }
  | { kind: 'published'; at: Instant; by: StaffId }

export type WorkflowAction =
  | { kind: 'submit' }
  | { kind: 'request_changes'; note: string }
  | { kind: 'publish' }
  | { kind: 'schedule'; publishAt: Instant }
  | { kind: 'unpublish' }

export type WorkflowRefusal =
  | { kind: 'role_cannot'; role: StaffRole; action: WorkflowAction['kind'] }
  | { kind: 'invalid_from'; from: EditorialState['kind']; action: WorkflowAction['kind'] }
  | { kind: 'schedule_in_past' }

/**
 * The stored `workflow` field is the only owner of editorial state; the CMS adapter derives Payload's
 * `_status` from it. Authors can only `submit`. Re-applying an action to the state it produced returns that state.
 */
export const transition = (
  state: EditorialState,
  action: WorkflowAction,
  actor: { id: StaffId; role: StaffRole },
  now: Instant,
): Result<EditorialState, WorkflowRefusal> => notImplemented()
