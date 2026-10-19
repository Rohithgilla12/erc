import { describe, expect, it } from 'vitest'
import { transition, type EditorialState, type Instant, type StaffId, type StaffRole, type WorkflowAction } from './index'

const authorActor = { id: 1 as StaffId, role: 'author' as StaffRole }
const editorActor = { id: 2 as StaffId, role: 'editor' as StaffRole }
const adminActor = { id: 3 as StaffId, role: 'admin' as StaffRole }

const earlier = '2026-10-18T09:00:00.000Z' as Instant
const now = '2026-10-19T09:00:00.000Z' as Instant
const later = '2026-10-19T09:05:00.000Z' as Instant
const tomorrow = '2026-10-20T04:30:00.000Z' as Instant

const states = {
  draft: { kind: 'draft' },
  in_review: { kind: 'in_review', submittedBy: authorActor.id, at: earlier },
  changes_requested: { kind: 'changes_requested', by: editorActor.id, note: 'Cite the study', at: earlier },
  scheduled: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
  published: { kind: 'published', at: earlier, by: editorActor.id },
} satisfies Record<EditorialState['kind'], EditorialState>

const actions = {
  submit: { kind: 'submit' },
  request_changes: { kind: 'request_changes', note: 'Add a cooldown week' },
  publish: { kind: 'publish' },
  schedule: { kind: 'schedule', publishAt: tomorrow },
  unpublish: { kind: 'unpublish' },
} satisfies Record<WorkflowAction['kind'], WorkflowAction>

type From = keyof typeof states
type Act = keyof typeof actions

const unchanged = Symbol('unchanged')
const invalid = Symbol('invalid_from')

const editorMatrix: Record<From, Record<Act, EditorialState | typeof unchanged | typeof invalid>> = {
  draft: {
    submit: { kind: 'in_review', submittedBy: editorActor.id, at: now },
    request_changes: invalid,
    publish: { kind: 'published', at: now, by: editorActor.id },
    schedule: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
    unpublish: unchanged,
  },
  in_review: {
    submit: unchanged,
    request_changes: { kind: 'changes_requested', by: editorActor.id, note: 'Add a cooldown week', at: now },
    publish: { kind: 'published', at: now, by: editorActor.id },
    schedule: { kind: 'scheduled', publishAt: tomorrow, by: editorActor.id },
    unpublish: invalid,
  },
  changes_requested: {
    submit: { kind: 'in_review', submittedBy: editorActor.id, at: now },
    request_changes: invalid,
    publish: { kind: 'published', at: now, by: editorActor.id },
    schedule: invalid,
    unpublish: invalid,
  },
  scheduled: {
    submit: invalid,
    request_changes: invalid,
    publish: { kind: 'published', at: now, by: editorActor.id },
    schedule: unchanged,
    unpublish: { kind: 'draft' },
  },
  published: {
    submit: invalid,
    request_changes: invalid,
    publish: unchanged,
    schedule: invalid,
    unpublish: { kind: 'draft' },
  },
}

const matrixCases = Object.entries(editorMatrix).flatMap(([from, row]) =>
  Object.entries(row).map(([action, expected]) => [from as From, action as Act, expected] as const),
)

describe('transition for an editor', () => {
  it.each(matrixCases)('from %s, %s', (from, action, expected) => {
    const result = transition(states[from], actions[action], editorActor, now)
    if (expected === unchanged) expect(result).toEqual({ ok: true, value: states[from] })
    else if (expected === invalid) expect(result).toEqual({ ok: false, error: { kind: 'invalid_from', from, action } })
    else expect(result).toEqual({ ok: true, value: expected })
  })

  it('gives an admin the same powers', () => {
    expect(transition(states.in_review, actions.publish, adminActor, now)).toEqual({
      ok: true,
      value: { kind: 'published', at: now, by: adminActor.id },
    })
  })
})

describe('transition for an author', () => {
  it.each(['draft', 'changes_requested'] as const)('submits from %s for review', (from) => {
    expect(transition(states[from], actions.submit, authorActor, now)).toEqual({
      ok: true,
      value: { kind: 'in_review', submittedBy: authorActor.id, at: now },
    })
  })

  const forbidden = (Object.keys(states) as From[]).flatMap((from) =>
    (['request_changes', 'publish', 'schedule', 'unpublish'] as const).map((action) => [action, from] as const),
  )
  it.each(forbidden)('cannot %s from %s, even where the action would be a no-op', (action, from) => {
    expect(transition(states[from], actions[action], authorActor, now)).toEqual({
      ok: false,
      error: { kind: 'role_cannot', role: 'author', action },
    })
  })
})

describe('schedule time guard', () => {
  it('refuses a publish time equal to now', () => {
    expect(transition(states.draft, { kind: 'schedule', publishAt: now }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('refuses a publish time in the past', () => {
    expect(transition(states.in_review, { kind: 'schedule', publishAt: earlier }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('compares instants, not strings, so the same moment written in IST is still not in the future', () => {
    const sameMomentInIst = '2026-10-19T14:30:00+05:30' as Instant
    expect(transition(states.draft, { kind: 'schedule', publishAt: sameMomentInIst }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'schedule_in_past' },
    })
  })

  it('accepts a publish time one second ahead', () => {
    const justAhead = '2026-10-19T09:00:01.000Z' as Instant
    expect(transition(states.draft, { kind: 'schedule', publishAt: justAhead }, editorActor, now)).toEqual({
      ok: true,
      value: { kind: 'scheduled', publishAt: justAhead, by: editorActor.id },
    })
  })

  it('refuses to move an already scheduled item to a different time', () => {
    const other = '2026-10-21T04:30:00.000Z' as Instant
    expect(transition(states.scheduled, { kind: 'schedule', publishAt: other }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'invalid_from', from: 'scheduled', action: 'schedule' },
    })
  })
})

describe('idempotency', () => {
  const replays: [string, EditorialState, WorkflowAction, { id: StaffId; role: StaffRole }][] = [
    ['publish', states.draft, actions.publish, editorActor],
    ['submit', states.draft, actions.submit, authorActor],
    ['schedule', states.draft, actions.schedule, editorActor],
    ['request_changes', states.in_review, actions.request_changes, editorActor],
    ['unpublish', states.published, actions.unpublish, editorActor],
  ]

  it.each(replays)('a retried %s returns the first result, keeping its original timestamp', (_name, start, action, actor) => {
    const first = transition(start, action, actor, now)
    if (!first.ok) throw new Error(`first ${action.kind} was refused`)
    expect(transition(first.value, action, actor, later)).toEqual(first)
  })

  it('treats a request for different changes as a new transition, which changes_requested does not allow', () => {
    expect(transition(states.changes_requested, { kind: 'request_changes', note: 'Something else' }, editorActor, now)).toEqual({
      ok: false,
      error: { kind: 'invalid_from', from: 'changes_requested', action: 'request_changes' },
    })
  })
})
