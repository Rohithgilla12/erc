import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Cursor, Page } from '@erc/contract'
import type { Activity, LocalDate, ManualEntry, MemberId, Metres, Period, PublicSource, Seconds, SourceRef } from '@erc/domain'
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

/** Upsert on (member, source, ref): a form sent twice, or a client retrying, changes nothing the second time. */
export async function recordManual(payload: Payload, session: MemberSession, entry: ManualEntry): Promise<Activity<'manual'>> {
  const ref = entry.ref ?? (randomUUID() as SourceRef)
  const { rows } = await payload.db.drizzle.execute(sql`
    INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s)
    VALUES (${session.member}, 'manual', ${ref}, ${entry.on}, ${entry.distance}, ${entry.moving})
    ON CONFLICT (member_id, source, ref) DO UPDATE SET on_date = EXCLUDED.on_date, metres = EXCLUDED.metres, moving_s = EXCLUDED.moving_s
    RETURNING ${columns}`)
  return activityOf(rows[0] as Row) as Activity<'manual'>
}

export async function runsIn(payload: Payload, session: MemberSession, period: Period): Promise<readonly Activity<PublicSource>[]> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT ${columns} FROM activities
    WHERE member_id = ${session.member} AND on_date BETWEEN ${period.first} AND ${period.last}
    ORDER BY on_date DESC, logged_at DESC`)
  return (rows as Row[]).map(activityOf)
}

export const RUNS_PAGE_SIZE = 20

const encodeCursor = (run: Activity): Cursor => Buffer.from(`${run.on}|${run.loggedAt}|${run.ref}`).toString('base64url') as Cursor

const decodeCursor = (cursor: Cursor): [LocalDate, string, string] | null => {
  const parts = Buffer.from(cursor, 'base64url').toString().split('|')
  if (parts.length !== 3) return null
  const [on = '', loggedAt = '', ref = ''] = parts
  return /^\d{4}-\d{2}-\d{2}$/.test(on) && !Number.isNaN(Date.parse(loggedAt)) ? [on as LocalDate, loggedAt, ref] : null
}

/** Newest first. A cursor that does not decode starts from the top rather than failing the page. */
export async function listRuns(payload: Payload, session: MemberSession, after: Cursor | null): Promise<Page<Activity<PublicSource>>> {
  const from = after === null ? null : decodeCursor(after)
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT ${columns} FROM activities
    WHERE member_id = ${session.member}
      ${from ? sql`AND (on_date, logged_at, ref) < (${from[0]}::date, ${from[1]}::timestamptz, ${from[2]})` : sql``}
    ORDER BY on_date DESC, logged_at DESC, ref DESC
    LIMIT ${RUNS_PAGE_SIZE + 1}`)
  const items = (rows as Row[]).map(activityOf)
  const page = items.slice(0, RUNS_PAGE_SIZE)
  const last = page.at(-1)
  return { items: page, next: items.length > RUNS_PAGE_SIZE && last ? encodeCursor(last) : null }
}
