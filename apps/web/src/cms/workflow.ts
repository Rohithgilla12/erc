import {
  mayAct,
  NEW_DOCUMENT,
  transition,
  type EditorialState,
  type Instant,
  type LiveState,
  type StaffActor,
  type WorkflowAction,
  type WorkflowRefusal,
} from '@erc/domain'
import {
  APIError,
  ValidationError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type Field,
  type PayloadRequest,
  type Where,
} from 'payload'

import { actorOf, staffOf } from './access'
import { optionsFrom, shownWhen } from './fields'

/**
 * How a request asked Payload to write. `draft` adds a version and leaves the main row alone; the others write the
 * main row, sending `_status: 'published'`, `_status: 'draft'`, or no status.
 */
type EditorialSave = 'draft' | 'publish' | 'withdraw' | 'write'

declare module 'payload' {
  interface RequestContext {
    editorialSave?: EditorialSave | 'restore'
  }
}

type SentStatus = 'draft' | 'published' | undefined

const sentStatus = (data: unknown): SentStatus => {
  const status = (data as { _status?: unknown } | undefined)?._status
  return status === 'draft' || status === 'published' ? status : undefined
}

// Mirrors Payload's own `isSavingDraft`: create ignores the sent status, update lets `published` override the flag.
const saveOf = (operation: 'create' | 'update', draft: boolean, status: SentStatus): EditorialSave => {
  if (draft && (operation === 'create' || status !== 'published')) return 'draft'
  return status === 'published' ? 'publish' : status === 'draft' ? 'withdraw' : 'write'
}

/**
 * Records what the request sent before Payload's field hooks fill a missing `_status` from the stored document,
 * after which "sent nothing" and "sent the current status" look the same.
 */
export const captureEditorialSave: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  // Payload loads a bulk non-draft update's documents from the main row, which is the last live copy, so the save
  // would act on stale state and overwrite any pending revision with it.
  if (operation === 'update' && 'where' in args && args.where && !args.draft) {
    throw new APIError('Publish, unpublish, or save live content one document at a time, or save drafts in bulk.', 409, undefined, true)
  }
  if (operation === 'create' || operation === 'update') {
    req.context.editorialSave = saveOf(operation, Boolean(args.draft), sentStatus(args.data))
  }
  // A restore's status comes from the restored version, which only the change hook sees.
  if (operation === 'restoreVersion') req.context.editorialSave = args.draft ? 'draft' : 'restore'
  return args
}

const EDIT: WorkflowAction = { kind: 'edit' }
const PUBLISH: WorkflowAction = { kind: 'publish' }
const UNPUBLISH: WorkflowAction = { kind: 'unpublish' }

type Plan = { before: readonly WorkflowAction[]; after: readonly WorkflowAction[] }

/**
 * The workflow actions each save means, around any review request sent with it. Payload's Publish button sends
 * `publish`, its Unpublish button `withdraw`, and Save Draft `draft`. A status-less write to a published document
 * replaces live content, so it is a publish, and the role check refuses it to authors.
 */
const SAVE_PLANS: Readonly<Record<EditorialSave, Readonly<Record<LiveState['kind'], Plan>>>> = {
  draft: { none: { before: [EDIT], after: [] }, published: { before: [EDIT], after: [] } },
  publish: { none: { before: [EDIT], after: [PUBLISH] }, published: { before: [EDIT], after: [PUBLISH] } },
  withdraw: { none: { before: [EDIT], after: [] }, published: { before: [], after: [UNPUBLISH] } },
  write: { none: { before: [EDIT], after: [] }, published: { before: [EDIT], after: [PUBLISH] } },
}

type ReviewRequest = Extract<WorkflowAction, { kind: 'submit' | 'request_changes' }>['kind']

const REVIEW_REQUESTS = optionsFrom<ReviewRequest>({ submit: 'Submit for review', request_changes: 'Request changes' })

/**
 * Submit and Request changes have no native button, so they ride along with a save as an unstored choice. A select
 * needs no custom admin component, and the save that carries it is the same request the role check already sees.
 */
export const reviewRequestFields: Field[] = [
  {
    name: 'reviewRequest',
    label: 'Review',
    type: 'select',
    virtual: true,
    options: REVIEW_REQUESTS,
    filterOptions: ({ options, req }) => {
      const role = staffOf(req)?.role
      return options.filter((option) => role && mayAct(role, (typeof option === 'string' ? option : option.value) as ReviewRequest))
    },
    admin: { position: 'sidebar', readOnly: false, description: 'Applied when you save.' },
  },
  {
    name: 'reviewNote',
    label: 'Changes to make',
    type: 'textarea',
    virtual: true,
    admin: { position: 'sidebar', readOnly: false, condition: shownWhen('reviewRequest', 'request_changes') },
  },
]

const requestedAction = (data: Record<string, unknown>): WorkflowAction | null => {
  const request = data.reviewRequest
  if (request == null || request === '') return null
  if (request === 'submit') return { kind: 'submit' }
  const note = typeof data.reviewNote === 'string' ? data.reviewNote.trim() : ''
  if (request === 'request_changes' && note) return { kind: 'request_changes', note }
  throw new ValidationError({
    errors: [
      request === 'request_changes'
        ? { message: 'Say what needs to change.', path: 'reviewNote' }
        : { message: 'Choose Submit for review or Request changes.', path: 'reviewRequest' },
    ],
  })
}

const statusOf = (live: LiveState): 'draft' | 'published' => (live.kind === 'published' ? 'published' : 'draft')

const published: Where = { _status: { equals: 'published' } }

export const publishedUnlessStaff = ({ req }: { req: PayloadRequest }) => (staffOf(req) ? true : published)

/**
 * Staff may save; sending `_status: 'published'` also needs the publish role. Payload asks this same question to
 * decide whether to show Publish and Unpublish, so authors see Save Draft only.
 */
export const editorialUpdate: Access = ({ req, data }) => {
  const staff = staffOf(req)
  if (!staff) return false
  return sentStatus(data) !== 'published' || mayAct(staff.role, 'publish')
}

/** Not `required`: callers never send it, and the change hook always writes it. */
/**
 * Deleting a published document takes it off the site, which is the publisher's call; anyone else may delete only
 * what is not live.
 */
export const editorialDelete: Access = ({ req }) => {
  const staff = staffOf(req)
  if (!staff) return false
  return mayAct(staff.role, 'unpublish') ? true : { _status: { not_equals: 'published' } }
}

export const workflowField: Field = {
  name: 'workflow',
  type: 'json',
  defaultValue: NEW_DOCUMENT,
  admin: { position: 'sidebar', readOnly: true },
}

/**
 * Runs the domain state machine for every editorial save and overwrites whatever the request sent for `workflow`.
 * The main row's `_status` comes from `live` alone; a draft save writes only a version, stamped `draft`, so
 * `?draft=true` reads that filter on `_status` can never see an unpublished revision.
 */
export const applyWorkflow: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req }) => {
  const captured = req.context.editorialSave
  if (!captured) throw new APIError('Editorial save reached the workflow without its save kind', 500)
  const save = captured === 'restore' ? saveOf('update', false, sentStatus(data)) : captured
  const { reviewRequest: _request, reviewNote: _note, ...rest } = data
  const current = operation === 'create' ? NEW_DOCUMENT : storedState(originalDoc)
  const requested = requestedAction(data)
  const plan = SAVE_PLANS[save][current.live.kind]
  const actions = [...plan.before, ...(requested ? [requested] : []), ...plan.after]
  const actor = actorOf(req)
  const now = new Date().toISOString() as Instant
  const next = actions.reduce((state, action) => transitionOrThrow(state, action, actor, now), current)
  return { ...rest, workflow: next, _status: save === 'draft' ? 'draft' : statusOf(next.live) }
}

const storedState = (doc: { workflow?: unknown } | undefined): EditorialState => {
  const stored = doc?.workflow as EditorialState | undefined
  if (!stored?.live || !stored.revision) throw new APIError('Stored editorial workflow is missing or malformed', 500)
  return stored
}

const REFUSAL_STATUS: Record<WorkflowRefusal['kind'], number> = { role_cannot: 403, invalid_from: 409, schedule_in_past: 409 }

function transitionOrThrow(state: EditorialState, action: WorkflowAction, actor: StaffActor, now: Instant): EditorialState {
  const result = transition(state, action, actor, now)
  if (!result.ok) throw new APIError(`Workflow refused ${action.kind}: ${result.error.kind}`, REFUSAL_STATUS[result.error.kind], result.error, true)
  return result.value
}
