import { randomBytes } from 'node:crypto'

import type { StaffRole } from '@erc/domain'
import type { Payload } from 'payload'

/**
 * The staff account a seed script acts as, tagged with its collection the way Payload's auth strategy tags a user, so
 * the Local API stamps decisions with it. Nobody signs in as it, so each run sets a fresh random password: an account
 * an older seed made with a guessable one stops accepting it the next time any seed runs.
 */
export async function seedStaffAccount(payload: Payload, email: string, role: StaffRole) {
  const password = randomBytes(32).toString('base64url')
  const context = { skipRevalidation: true }
  const { docs } = await payload.find({ collection: 'staff', where: { email: { equals: email } }, limit: 1, depth: 0 })
  const existing = docs[0]
  const staff = existing
    ? await payload.update({ collection: 'staff', id: existing.id, data: { password }, context })
    : await payload.create({ collection: 'staff', data: { email, password, role }, context })
  return { ...staff, collection: 'staff' as const }
}
