import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload, PayloadRequest } from 'payload'

/** The hourly email caps on the public forms. Each is counted under its own lock. */
export type EmailCap = 'newsletter-confirmations' | 'enquiry-staff-emails'

/**
 * Runs `work` in one transaction that first takes the cap's lock, so requests count the hour's emails and store their
 * own one at a time. Without it a burst of requests all read the same count under the cap and all send. Postgres
 * releases the lock when the transaction ends. `work` must pass `req` to every Local API call to stay on the
 * transaction's connection: a query on another connection could wait for the pool behind requests queued on the lock.
 */
export async function withCapLock<T>(payload: Payload, cap: EmailCap, work: (req: Partial<PayloadRequest>) => Promise<T>): Promise<T> {
  const transactionID = await payload.db.beginTransaction()
  if (transactionID === null) throw new Error('The hourly email caps need database transactions')
  try {
    // Payload types the session loosely; it is a transaction on the same Drizzle client as `payload.db.drizzle`.
    const transaction = payload.db.sessions?.[transactionID]?.db as typeof payload.db.drizzle | undefined
    if (!transaction) throw new Error('Payload opened no session for the transaction')
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${cap}))`)
    const result = await work({ transactionID })
    await payload.db.commitTransaction(transactionID)
    return result
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}
