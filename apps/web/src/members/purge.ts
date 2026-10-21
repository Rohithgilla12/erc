import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { getPayload, type Payload } from 'payload'

const PURGE_EVERY_MS = 60 * 60 * 1000

/** Expired sessions and day-old codes serve no purpose. Codes are kept a day so the hourly limits can count them. */
export async function purgeMemberRows(payload: Payload): Promise<void> {
  await payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE expires_at <= now()`)
  await payload.db.drizzle.execute(sql`DELETE FROM sign_in_codes WHERE sent_at < now() - interval '1 day'`)
}

/** Called once as the server starts. Purges then and every hour. */
export function scheduleMemberPurge() {
  const purge = async () => {
    try {
      await purgeMemberRows(await getPayload({ config }))
    } catch (error) {
      console.error('Could not delete expired member sessions and sign-in codes', error)
    }
  }
  void purge()
  setInterval(purge, PURGE_EVERY_MS).unref()
}
