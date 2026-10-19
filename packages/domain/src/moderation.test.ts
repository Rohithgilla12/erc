import { describe, expect, it } from 'vitest'
import { decide, type Email, type Instant, type Moderation, type StaffId } from './index'

const editor = 7 as StaffId
const earlier = '2026-10-18T09:00:00.000Z' as Instant
const now = '2026-10-19T09:00:00.000Z' as Instant
const submitted: Moderation = { state: 'submitted', submitter: { name: 'Asha', email: 'asha@example.com' as Email }, at: earlier }

describe('decide', () => {
  it('approves a submitted record, stamping who and when', () => {
    expect(decide(submitted, { kind: 'approve' }, editor, now)).toEqual({
      ok: true,
      value: { state: 'approved', by: editor, at: now },
    })
  })

  it('rejects a submitted record, keeping the reason', () => {
    expect(decide(submitted, { kind: 'reject', reason: 'Duplicate of Hyderabad 10K' }, editor, now)).toEqual({
      ok: true,
      value: { state: 'rejected', by: editor, at: now, reason: 'Duplicate of Hyderabad 10K' },
    })
  })

  const decided: Moderation[] = [
    { state: 'approved', by: 3 as StaffId, at: earlier },
    { state: 'rejected', by: 3 as StaffId, at: earlier, reason: 'spam' },
  ]
  it.each(decided.flatMap((current) => [
    [current.state, 'approve', current, { kind: 'approve' }] as const,
    [current.state, 'reject', current, { kind: 'reject', reason: 'again' }] as const,
  ]))('refuses to %s-then-%s', (_from, _decision, current, decision) => {
    expect(decide(current, decision, editor, now)).toEqual({ ok: false, error: 'already_decided' })
  })
})
