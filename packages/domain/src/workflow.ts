import type { StaffActor, StaffId, StaffRole } from './moderation'
import { err, ok, type Instant, type Result } from './primitives'

/** What readers see. */
export type LiveState = { kind: 'none' } | { kind: 'published'; at: Instant; by: StaffId }

/** The working copy on its way to replacing `live`. A published document can carry one, so its edits are reviewed too. */
export type RevisionState =
  | { kind: 'none' }
  | { kind: 'draft' }
  | { kind: 'in_review'; submittedBy: StaffId; at: Instant }
  | { kind: 'changes_requested'; by: StaffId; note: string; at: Instant }
  | { kind: 'scheduled'; publishAt: Instant; by: StaffId }

export type EditorialState = { live: LiveState; revision: RevisionState }

export const NEW_DOCUMENT: EditorialState = { live: { kind: 'none' }, revision: { kind: 'draft' } }

export type WorkflowAction =
  | { kind: 'edit' }
  | { kind: 'submit' }
  | { kind: 'request_changes'; note: string }
  | { kind: 'publish' }
  | { kind: 'schedule'; publishAt: Instant }
  | { kind: 'unpublish' }

type RevisionKind = RevisionState['kind']
type ActionKind = WorkflowAction['kind']

export type WorkflowRefusal =
  | { kind: 'role_cannot'; role: StaffRole; action: ActionKind }
  | { kind: 'invalid_from'; from: RevisionKind; action: ActionKind }
  | { kind: 'schedule_in_past' }

type ActionRule<A extends WorkflowAction> = {
  roles: readonly StaffRole[]
  /** True when `state` is what this action produces, so a retry returns it unchanged. */
  producedBy(state: EditorialState, action: A): boolean
  next(state: EditorialState, action: A, actor: StaffActor, now: Instant): Result<EditorialState, WorkflowRefusal>
}

const EVERYONE: readonly StaffRole[] = ['author', 'editor', 'admin']
const EDITORS: readonly StaffRole[] = ['editor', 'admin']

/** Which revisions each action may start from. `unpublish` acts on `live`, so every revision allows it. */
const ALLOWED: Readonly<Record<RevisionKind, readonly ActionKind[]>> = {
  none: ['edit', 'unpublish'],
  draft: ['edit', 'submit', 'publish', 'schedule', 'unpublish'],
  in_review: ['edit', 'request_changes', 'publish', 'schedule', 'unpublish'],
  changes_requested: ['edit', 'submit', 'publish', 'unpublish'],
  scheduled: ['edit', 'publish', 'unpublish'],
}

const withRevision = (state: EditorialState, revision: RevisionState): Result<EditorialState, WorkflowRefusal> =>
  ok({ live: state.live, revision })

const RULES: { [K in ActionKind]: ActionRule<Extract<WorkflowAction, { kind: K }>> } = {
  edit: {
    roles: EVERYONE,
    producedBy: ({ revision }) => revision.kind === 'draft' || revision.kind === 'in_review' || revision.kind === 'changes_requested',
    // Editing scheduled content drops the schedule, so changes nobody reviewed never go live at `publishAt`.
    next: (state) => withRevision(state, { kind: 'draft' }),
  },
  submit: {
    roles: EVERYONE,
    producedBy: ({ revision }) => revision.kind === 'in_review',
    next: (state, _, actor, now) => withRevision(state, { kind: 'in_review', submittedBy: actor.id, at: now }),
  },
  request_changes: {
    roles: EDITORS,
    producedBy: ({ revision }, action) => revision.kind === 'changes_requested' && revision.note === action.note,
    next: (state, action, actor, now) => withRevision(state, { kind: 'changes_requested', by: actor.id, note: action.note, at: now }),
  },
  publish: {
    roles: EDITORS,
    producedBy: ({ live, revision }) => live.kind === 'published' && revision.kind === 'none',
    next: (_, __, actor, now) => ok({ live: { kind: 'published', at: now, by: actor.id }, revision: { kind: 'none' } }),
  },
  schedule: {
    roles: EDITORS,
    producedBy: ({ revision }, action) => revision.kind === 'scheduled' && revision.publishAt === action.publishAt,
    next: (state, action, actor, now) =>
      Date.parse(action.publishAt) > Date.parse(now)
        ? withRevision(state, { kind: 'scheduled', publishAt: action.publishAt, by: actor.id })
        : err({ kind: 'schedule_in_past' }),
  },
  unpublish: {
    roles: EDITORS,
    producedBy: ({ live }) => live.kind === 'none',
    // The content that was live becomes the draft, so a document is never left with nothing to work on.
    next: ({ revision }) => ok({ live: { kind: 'none' }, revision: revision.kind === 'none' ? { kind: 'draft' } : revision }),
  },
}

export const mayAct = (role: StaffRole, action: ActionKind): boolean => RULES[action].roles.includes(role)

/**
 * The stored `workflow` field is the only owner of editorial state; the CMS adapter derives Payload's `_status`
 * from `live`. Authors can edit and submit; editors and admins do the rest. Re-applying an action to the state it
 * produced returns that state.
 */
export const transition = (
  state: EditorialState,
  action: WorkflowAction,
  actor: StaffActor,
  now: Instant,
): Result<EditorialState, WorkflowRefusal> => {
  const rule = RULES[action.kind] as ActionRule<WorkflowAction>
  if (!rule.roles.includes(actor.role)) return err({ kind: 'role_cannot', role: actor.role, action: action.kind })
  if (rule.producedBy(state, action)) return ok(state)
  if (!ALLOWED[state.revision.kind].includes(action.kind)) {
    return err({ kind: 'invalid_from', from: state.revision.kind, action: action.kind })
  }
  return rule.next(state, action, actor, now)
}
