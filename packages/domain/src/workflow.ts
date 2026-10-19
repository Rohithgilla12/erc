import type { StaffId, StaffRole } from './moderation'
import { err, ok, type Instant, type Result } from './primitives'

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
type StateKind = EditorialState['kind']
type ActionKind = WorkflowAction['kind']
type Actor = { id: StaffId; role: StaffRole }

type ActionRule<A extends WorkflowAction> = {
  roles: readonly StaffRole[]
  producedBy(state: EditorialState, action: A): boolean
  next(action: A, actor: Actor, now: Instant): Result<EditorialState, WorkflowRefusal>
}

const EDITORS: readonly StaffRole[] = ['editor', 'admin']

const ALLOWED: Readonly<Record<StateKind, readonly ActionKind[]>> = {
  draft: ['submit', 'publish', 'schedule'],
  in_review: ['request_changes', 'publish', 'schedule'],
  changes_requested: ['submit', 'publish'],
  scheduled: ['publish', 'unpublish'],
  published: ['unpublish'],
}

const RULES: { [K in ActionKind]: ActionRule<Extract<WorkflowAction, { kind: K }>> } = {
  submit: {
    roles: ['author', 'editor', 'admin'],
    producedBy: (state) => state.kind === 'in_review',
    next: (_, actor, now) => ok({ kind: 'in_review', submittedBy: actor.id, at: now }),
  },
  request_changes: {
    roles: EDITORS,
    producedBy: (state, action) => state.kind === 'changes_requested' && state.note === action.note,
    next: (action, actor, now) => ok({ kind: 'changes_requested', by: actor.id, note: action.note, at: now }),
  },
  publish: {
    roles: EDITORS,
    producedBy: (state) => state.kind === 'published',
    next: (_, actor, now) => ok({ kind: 'published', at: now, by: actor.id }),
  },
  schedule: {
    roles: EDITORS,
    producedBy: (state, action) => state.kind === 'scheduled' && state.publishAt === action.publishAt,
    next: (action, actor, now) =>
      Date.parse(action.publishAt) > Date.parse(now)
        ? ok({ kind: 'scheduled', publishAt: action.publishAt, by: actor.id })
        : err({ kind: 'schedule_in_past' }),
  },
  unpublish: {
    roles: EDITORS,
    producedBy: (state) => state.kind === 'draft',
    next: () => ok({ kind: 'draft' }),
  },
}

export const transition = (
  state: EditorialState,
  action: WorkflowAction,
  actor: { id: StaffId; role: StaffRole },
  now: Instant,
): Result<EditorialState, WorkflowRefusal> => {
  const rule = RULES[action.kind] as ActionRule<WorkflowAction>
  if (!rule.roles.includes(actor.role)) return err({ kind: 'role_cannot', role: actor.role, action: action.kind })
  if (rule.producedBy(state, action)) return ok(state)
  if (!ALLOWED[state.kind].includes(action.kind)) return err({ kind: 'invalid_from', from: state.kind, action: action.kind })
  return rule.next(action, actor, now)
}
