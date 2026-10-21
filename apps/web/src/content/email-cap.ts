import { sql } from '@payloadcms/db-postgres/drizzle'
import type { EmailPurpose } from '@erc/domain'
import type { Payload, PayloadRequest } from 'payload'

/** The transaction's own Drizzle client, for raw SQL that must see and join the lock holder's writes. */
export type Transaction = Payload['db']['drizzle']

/**
 * Runs `work` in one transaction that first takes the purpose's lock, so requests count the hour's emails and store
 * their own one at a time. Without it a burst of requests all read the same count under the cap and all send. Postgres
 * releases the lock when the transaction ends. `work` must pass `req` to every Local API call, and run raw SQL on
 * `transaction`, to stay on the transaction's connection: a query on another connection could wait for the pool behind
 * requests queued on the lock.
 */
export async function withCapLock<T>(payload: Payload, purpose: EmailPurpose, work: (req: Partial<PayloadRequest>, transaction: Transaction) => Promise<T>): Promise<T> {
  const transactionID = await payload.db.beginTransaction()
  if (transactionID === null) throw new Error('The hourly email caps need database transactions')
  try {
    // Payload types the session loosely; it is a transaction on the same Drizzle client as `payload.db.drizzle`.
    const transaction = payload.db.sessions?.[transactionID]?.db as Transaction | undefined
    if (!transaction) throw new Error('Payload opened no session for the transaction')
    // A holder that hangs would otherwise queue every later request, and the pool behind them, until a restart.
    await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`)
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${purpose}))`)
    const result = await work({ transactionID }, transaction)
    await payload.db.commitTransaction(transactionID)
    return result
  } catch (error) {
    await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}
