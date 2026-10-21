import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import { encodeRunCursor, type Page, type RunCursor } from '@erc/contract'
import { err, ok, RUNS_LOGGED_PER_HOUR, type Activity, type LocalDate, type ManualEntry, type MemberId, type Metres, type Period, type PublicSource, type Result, type Seconds, type SourceRef } from '@erc/domain'
import type { Payload } from 'payload'

import { instantOf, type MemberSession } from './session'

type Row = { member_id: number; source: PublicSource; ref: string; on_date: string; metres: number; moving_s: number; logged_at: Date | string }

const columns = sql`member_id, source, ref, on_date::text AS on_date, metres, moving_s, logged_at`

const activityOf = (row: Row): Activity<PublicSource> => ({
  member: row.member_id as MemberId,
  source: row.source,
  ref: row.ref as SourceRef,
  on: row.on_date as LocalDate,
  distance: row.metres as Metres,
  moving: row.moving_s as Seconds,
  loggedAt: instantOf(row.logged_at),
})

/**
 * Upsert on (member, source, ref): a form sent twice, or a client retrying, changes nothing the second time. Refuses
 * once the member has logged `RUNS_LOGGED_PER_HOUR` entries in the hour; `logged_at` is never updated, so a retry of
 * an existing entry is neither counted again nor refused.
 */
export async function recordManual(payload: Payload, session: MemberSession, entry: ManualEntry): Promise<Result<Activity<'manual'>, 'too_many'>> {
  const db = payload.db.drizzle
  const recent = await db.execute(sql`SELECT count(*)::int AS n FROM activities WHERE member_id = ${session.member} AND logged_at > now() - interval '1 hour'`)
  if ((recent.rows[0] as { n: number }).n >= RUNS_LOGGED_PER_HOUR && !(entry.ref && (await hasEntry(payload, session, entry.ref)))) return err('too_many')
  const ref = entry.ref ?? (randomUUID() as SourceRef)
  const { rows } = await db.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s)
    VALUES (${session.member}, 'manual', ${ref}, ${entry.on}, ${entry.distance}, ${entry.moving})
    ON CONFLICT (member_id, source, ref) DO UPDATE SET on_date = EXCLUDED.on_date, metres = EXCLUDED.metres, moving_s = EXCLUDED.moving_s
    RETURNING ${columns}`)
  return ok(activityOf(rows[0] as Row) as Activity<'manual'>)
}

async function hasEntry(payload: Payload, session: MemberSession, ref: SourceRef): Promise<boolean> {
  const { rows } = await payload.db.drizzle.execute(sql`SELECT 1 FROM activities WHERE member_id = ${session.member} AND source = 'manual' AND ref = ${ref}`)
  return rows.length > 0
}

export async function runsIn(payload: Payload, session: MemberSession, period: Period): Promise<readonly Activity<PublicSource>[]> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT ${columns} FROM activities
    WHERE member_id = ${session.member} AND on_date BETWEEN ${period.first} AND ${period.last}
    ORDER BY on_date DESC, logged_at DESC`)
  return (rows as Row[]).map(activityOf)
}

export const RUNS_PAGE_SIZE = 20

/** Newest first, from just after the parsed cursor. The contract's parser has already refused anything malformed. */
export async function listRuns(payload: Payload, session: MemberSession, after: RunCursor | null): Promise<Page<Activity<PublicSource>>> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT ${columns} FROM activities
    WHERE member_id = ${session.member}
      ${after ? sql`AND (on_date, logged_at, ref) < (${after.on}::date, ${after.loggedAt}::timestamptz, ${after.ref})` : sql``}
    ORDER BY on_date DESC, logged_at DESC, ref DESC
    LIMIT ${RUNS_PAGE_SIZE + 1}`)
  const items = (rows as Row[]).map(activityOf)
  const page = items.slice(0, RUNS_PAGE_SIZE)
  const last = page.at(-1)
  return { items: page, next: items.length > RUNS_PAGE_SIZE && last ? encodeRunCursor(last) : null }
}
