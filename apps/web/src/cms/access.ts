import type { StaffActor, StaffId } from '@erc/domain'
import { Forbidden, type PayloadRequest } from 'payload'

type AccessArgs = { req: PayloadRequest }

// Members are never Payload users (they sign in through src/members), so "logged in" here can only mean staff.
export const staffOf = ({ user }: PayloadRequest) => (user?.collection === 'staff' ? user : null)

export const isStaff = ({ req }: AccessArgs) => staffOf(req) !== null

export const isAdmin = ({ req }: AccessArgs) => staffOf(req)?.role === 'admin'

export const isAdminOrSelf = ({ req }: AccessArgs) => {
  const staff = staffOf(req)
  if (!staff) return false
  return staff.role === 'admin' ? true : { id: { equals: staff.id } }
}

/** The acting staff member for a domain rule; anyone else is refused before the rule runs. */
export function actorOf(req: PayloadRequest): StaffActor {
  const staff = staffOf(req)
  if (!staff) throw new Forbidden(req.t)
  return { id: staff.id as StaffId, role: staff.role }
}
