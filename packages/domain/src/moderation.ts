import { err, ok, type Email, type Id, type Instant, type Result } from './primitives'

export type StaffRole = 'admin' | 'editor' | 'author'
export type StaffId = Id<'staff'>
export type StaffActor = { id: StaffId; role: StaffRole }

/** One moderation model for every public intake: race submissions now, profile claims and results in Phase 2. */
export type Submitter = { name: string; email: Email }
export type Moderation =
  | { state: 'submitted'; submitter: Submitter | { staff: StaffId }; at: Instant }
  | { state: 'approved'; by: StaffId; at: Instant }
  | { state: 'rejected'; by: StaffId; at: Instant; reason: string }

export type ModerationDecision = { kind: 'approve' } | { kind: 'reject'; reason: string }
export type ModerationRefusal = 'role_cannot' | 'already_decided'

const DECIDERS: readonly StaffRole[] = ['editor', 'admin']

export const mayDecide = (role: StaffRole): boolean => DECIDERS.includes(role)

/** Only the state matters: a decision is final, and who decided and when come from the actor and the clock. */
export const decide = (
  current: Pick<Moderation, 'state'>,
  decision: ModerationDecision,
  actor: StaffActor,
  now: Instant,
): Result<Moderation, ModerationRefusal> => {
  if (!mayDecide(actor.role)) return err('role_cannot')
  if (current.state !== 'submitted') return err('already_decided')
  return ok(
    decision.kind === 'approve'
      ? { state: 'approved', by: actor.id, at: now }
      : { state: 'rejected', by: actor.id, at: now, reason: decision.reason },
  )
}
