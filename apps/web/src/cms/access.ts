import type { PayloadRequest } from 'payload'

type AccessArgs = { req: PayloadRequest }

// Phase 2 adds a `members` auth collection, so "logged in" must never be read as "staff".
export const staffOf = ({ user }: PayloadRequest) => (user?.collection === 'staff' ? user : null)

export const isStaff = ({ req }: AccessArgs) => staffOf(req) !== null

export const isAdmin = ({ req }: AccessArgs) => staffOf(req)?.role === 'admin'

export const isAdminOrSelf = ({ req }: AccessArgs) => {
  const staff = staffOf(req)
  if (!staff) return false
  return staff.role === 'admin' ? true : { id: { equals: staff.id } }
}
