import { describe, expect, it } from 'vitest'
import {
  NEW_DOCUMENT,
  transition,
  type EditorialState,
  type Instant,
  type LiveState,
  type RevisionState,
  type StaffActor,
  type StaffId,
  type WorkflowAction,
} from './index'

const authorActor: StaffActor = { id: 1 as StaffId, role: 'author' }
const editorActor: StaffActor = { id: 2 as StaffId, role: 'editor' }
const adminActor: StaffActor = { id: 3 as StaffId, role: 'admin' }

const earlier = '2026-10-18T09:00:00.000Z' as Instant
const now = '2026-10-19T09:00:00.000Z' as Instant
const later = '2026-10-19T09:05:00.000Z' as Instant
const tomorrow = '2026-10-20T04:30:00.000Z' as Instant

const lives = {
  none: { kind: 'none' },
  published: { kind: 'published', at: earlier, by: editorActor.id },
} satisfies Record<LiveState['kind'], LiveState>

const revisions = {
  none: { kind: 'none' },
  draft: { kind: 'draft' },
  in_review: { kind: 'in_review', submittedBy: authorActor.id, at: earlier },
  changes_requested: { kind: 'changes_requested', by: editorActor.id, note: 'Cite the study', at: earlier },
  scheduled: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
} satisfies Record<RevisionState['kind'], RevisionState>

const actions = {
  edit: { kind: 'edit' },
  submit: { kind: 'submit' },
  request_changes: { kind: 'request_changes', note: 'Add a cooldown week' },
  publish: { kind: 'publish' },
  schedule: { kind: 'schedule', publishAt: tomorrow },
  unpublish: { kind: 'unpublish' },
} satisfies Record<WorkflowAction['kind'], WorkflowAction>

type Rev = keyof typeof revisions
type Act = keyof typeof actions

const state = (live: LiveState, revision: RevisionState): EditorialState => ({ live, revision })
const live = (revision: RevisionState) => state(lives.published, revision)

// {live none, revision none} is a document with nothing to work on; no transition produces it.
const reachable: EditorialState[] = [
  ...Object.values(revisions).map((revision) => state(lives.published, revision)),
  ...Object.values(revisions)
    .filter((revision) => revision.kind !== 'none')
    .map((revision) => state(lives.none, revision)),
]

const unchanged = Symbol('unchanged')
const invalid = Symbol('invalid_from')

const republished = state({ kind: 'published', at: now, by: editorActor.id }, revisions.none)

/** An editor acting on a published document, for every revision it can carry. */
const editorOnPublished: Record<Rev, Record<Act, RevisionState | EditorialState | typeof unchanged | typeof invalid>> = {
  none: {
    edit: revisions.draft,
    submit: invalid,
    request_changes: invalid,
    publish: unchanged,
    schedule: invalid,
    unpublish: state(lives.none, revisions.draft),
  },
  draft: {
    edit: unchanged,
    submit: { kind: 'in_review', submittedBy: editorActor.id, at: now },
    request_changes: invalid,
    publish: republished,
    schedule: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
    unpublish: state(lives.none, revisions.draft),
  },
  in_review: {
    edit: unchanged,
    submit: unchanged,
    request_changes: { kind: 'changes_requested', by: editorActor.id, note: 'Add a cooldown week', at: now },
    publish: republished,
    schedule: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
    unpublish: state(lives.none, revisions.in_review),
  },
  changes_requested: {
    edit: unchanged,
    submit: { kind: 'in_review', submittedBy: editorActor.id, at: now },
    request_changes: invalid,
    publish: republished,
    schedule: invalid,
    unpublish: state(lives.none, revisions.changes_requested),
  },
  scheduled: {
    edit: revisions.draft,
    submit: invalid,
    request_changes: invalid,
    publish: republished,
    schedule: unchanged,
    unpublish: state(lives.none, revisions.scheduled),
  },
}

const matrixCases = Object.entries(editorOnPublished).flatMap(([from, row]) =>
  Object.entries(row).map(([action, expected]) => [from as Rev, action as Act, expected] as const),
)

describe('transition for an editor on a published document', () => {
  it.each(matrixCases)('from revision %s, %s', (from, action, expected) => {
    const start = live(revisions[from])
    const result = transition(start, actions[action], editorActor, now)
    if (expected === unchanged) expect(result).toEqual({ ok: true, value: start })
    else if (expected === invalid) expect(result).toEqual({ ok: false, error: { kind: 'invalid_from', from, action } })
    else if ('live' in expected) expect(result).toEqual({ ok: true, value: expected })
    else expect(result).toEqual({ ok: true, value: live(expected) })
  })

  it('gives an admin the same powers', () => {
    expect(transition(live(revisions.in_review), actions.publish, adminActor, now)).toEqual({
      ok: true,
      value: state({ kind: 'published', at: now, by: adminActor.id }, revisions.none),
    })
  })
})

describe('transition on a document that has never been published', () => {
  it('starts as a draft with nothing live', () => {
    expect(NEW_DOCUMENT).toEqual(state(lives.none, revisions.draft))
  })

  it('publishes the revision', () => {
    expect(transition(state(lives.none, revisions.in_review), actions.publish, editorActor, now)).toEqual({
      ok: true,
      value: republished,
    })
  })

  it('treats unpublish as already done and keeps the revision', () => {
    const start = state(lives.none, revisions.changes_requested)
    expect(transition(start, actions.unpublish, editorActor, now)).toEqual({ ok: true, value: start })
  })
})

describe('the live copy', () => {
  it('changes only through publish and unpublish', () => {
    const others = (Object.keys(actions) as Act[]).filter((action) => action !== 'publish' && action !== 'unpublish')
    for (const start of reachable) {
      for (const action of others) {
        const result = transition(start, actions[action], editorActor, now)
        if (result.ok) expect(result.value.live, `${action} from ${JSON.stringify(start)}`).toEqual(start.live)
      }
    }
  })

  it('never ends up with nothing live and no revision', () => {
    for (const start of reachable) {
      for (const action of Object.values(actions)) {
        const result = transition(start, action, editorActor, now)
        if (result.ok) expect(result.value, `${action.kind} from ${JSON.stringify(start)}`).not.toEqual(state(lives.none, revisions.none))
      }
    }
  })
})

describe('transition for an author', () => {
  it('opens a draft revision by editing a published document, leaving the live copy alone', () => {
    expect(transition(live(revisions.none), actions.edit, authorActor, now)).toEqual({
      ok: true,
      value: live(revisions.draft),
    })
  })

  it.each(['draft', 'changes_requested'] as const)('submits a %s revision for review', (from) => {
    expect(transition(live(revisions[from]), actions.submit, authorActor, now)).toEqual({
      ok: true,
      value: live({ kind: 'in_review', submittedBy: authorActor.id, at: now }),
    })
  })

  it('never changes what is live, whatever the revision', () => {
    for (const start of reachable) {
      for (const action of Object.values(actions)) {
        const result = transition(start, action, authorActor, now)
        if (result.ok) expect(result.value.live, `${action.kind} from ${JSON.stringify(start)}`).toEqual(start.live)
      }
    }
  })

  const forbidden = reachable.flatMap((start) =>
    (['request_changes', 'publish', 'schedule', 'unpublish'] as const).map((action) => [action, start] as const),
  )
  it.each(forbidden)('cannot %s from %j, even where the action would be a no-op', (action, start) => {
    expect(transition(start, actions[action], authorActor, now)).toEqual({
      ok: false,
      error: { kind: 'role_cannot', role: 'author', action },
    })
  })

  it('drops a schedule by editing, so the scheduled publish cannot carry unreviewed changes', () => {
    expect(transition(live(revisions.scheduled), actions.edit, authorActor, now)).toEqual({
      ok: true,
      value: live(revisions.draft),
    })
  })
})

describe('schedule time guard', () => {
  it('refuses a publish time equal to now', () => {
    expect(transition(live(revisions.draft), { kind: 'schedule', publishAt: now }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('refuses a publish time in the past', () => {
    expect(transition(live(revisions.in_review), { kind: 'schedule', publishAt: earlier }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('compares instants, not strings, so the same moment written in IST is still not in the future', () => {
    const sameMomentInIst = '2026-10-19T14:30:00+05:30' as Instant
    expect(transition(live(revisions.draft), { kind: 'schedule', publishAt: sameMomentInIst }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('accepts a publish time one second ahead', () => {
    const justAhead = '2026-10-19T09:00:01.000Z' as Instant
    expect(transition(live(revisions.draft), { kind: 'schedule', publishAt: justAhead }, editorActor, now)).toEqual({
      ok: true,
      value: live({ kind: 'scheduled', publishAt: justAhead, by: editorActor.id }),
    })
  })

  it('refuses to move an already scheduled revision to a different time', () => {
    const other = '2026-10-21T04:30:00.000Z' as Instant
    expect(transition(live(revisions.scheduled), { kind: 'schedule', publishAt: other }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'invalid_from', from: 'scheduled', action: 'schedule' },
    })
  })
})

describe('idempotency', () => {
  const replays: [string, EditorialState, WorkflowAction, StaffActor][] = [
    ['edit', live(revisions.none), actions.edit, authorActor],
    ['publish', live(revisions.draft), actions.publish, editorActor],
    ['submit', live(revisions.draft), actions.submit, authorActor],
    ['schedule', live(revisions.draft), actions.schedule, editorActor],
    ['request_changes', live(revisions.in_review), actions.request_changes, editorActor],
    ['unpublish', live(revisions.none), actions.unpublish, editorActor],
  ]

  it.each(replays)('a retried %s returns the first result, keeping its original timestamp', (_name, start, action, actor) => {
    const first = transition(start, action, actor, now)
    if (!first.ok) throw new Error(`first ${action.kind} was refused`)
    expect(transition(first.value, action, actor, later)).toEqual(first)
  })

  it('treats a request for different changes as a new transition, which changes_requested does not allow', () => {
    const start = live(revisions.changes_requested)
    expect(transition(start, { kind: 'request_changes', note: 'Something else' }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'invalid_from', from: 'changes_requested', action: 'request_changes' },
    })
  })
})
