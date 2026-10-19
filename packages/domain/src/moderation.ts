import { err, ok, type Email, type Id, type Instant, type Result } from './primitives'

export type StaffRole = 'admin' | 'editor' | 'author'
export type StaffId = Id<'staff'>

/** One moderation model for every public intake: race submissions now, profile claims and results in Phase 2. */
export type Submitter = { name: string; email: Email }
export type Moderation =
  | { state: 'submitted'; submitter: Submitter | { staff: StaffId }; at: Instant }
  | { state: 'approved'; by: StaffId; at: Instant }
  | { state: 'rejected'; by: StaffId; at: Instant; reason: string }

export type ModerationDecision = { kind: 'approve' } | { kind: 'reject'; reason: string }

export const decide = (
  current: Moderation,
  decision: ModerationDecision,
  by: StaffId,
  now: Instant,
): Result<Moderation, 'already_decided'> => {
  if (current.state !== 'submitted') return err('already_decided')
  return ok(
    decision.kind === 'approve'
      ? { state: 'approved', by, at: now }
      : { state: 'rejected', by, at: now, reason: decision.reason },
  )
}
