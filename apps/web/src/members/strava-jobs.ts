import { sql } from '@payloadcms/db-postgres/drizzle'
import type { MemberId, StravaActivityId } from '@erc/domain'

import type { Executor } from './run-metrics'

export const STRAVA_JOB_KINDS = ['detail', 'streams'] as const
export type StravaJobKind = (typeof STRAVA_JOB_KINDS)[number]

const idArray = (ids: readonly StravaActivityId[]) => `{${ids.join(',')}}`

/**
 * Queues a fetch now, whatever state an earlier job for the same activity is in: a webhook says the activity changed,
 * so a job backing off from an old failure starts again. `enqueued_at` moves, so a drain finishing the older request
 * leaves this one queued.
 */
export async function queueStravaJob(db: Executor, member: MemberId, id: StravaActivityId, kind: StravaJobKind): Promise<void> {
  await db.execute(sql`
    INSERT INTO strava_jobs (member_id, strava_activity_id, kind) VALUES (${member}, ${id}, ${kind})
    ON CONFLICT (strava_activity_id, kind) DO UPDATE SET
      member_id = EXCLUDED.member_id, attempts = 0, not_before = now(), enqueued_at = clock_timestamp(), last_error = NULL`)
}

/**
 * Queues only what is not stored yet: a detail job for runs never fetched in full, a streams job for runs without
 * streams. A job already waiting keeps its backoff. List syncs call this for every run they see, so re-syncing the same
 * 90 days spends no API calls on runs that are complete.
 */
export async function queueMissingStravaWork(db: Executor, member: MemberId, ids: readonly StravaActivityId[]): Promise<void> {
  if (ids.length === 0) return
  await db.execute(sql`
    INSERT INTO strava_jobs (member_id, strava_activity_id, kind)
    SELECT ${member}, v.id, k.kind
    FROM unnest(${idArray(ids)}::bigint[]) AS v(id)
    CROSS JOIN (VALUES ('detail'), ('streams')) AS k(kind)
    WHERE NOT EXISTS (
      SELECT 1 FROM activity_metrics m
      WHERE k.kind = 'detail' AND m.member_id = ${member} AND m.source = 'strava' AND m.ref = 'strava:' || v.id AND m.detailed_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM activity_streams s
      WHERE k.kind = 'streams' AND s.member_id = ${member} AND s.source = 'strava' AND s.ref = 'strava:' || v.id
    )
    ON CONFLICT (strava_activity_id, kind) DO NOTHING`)
}

export async function dropStravaJobs(db: Executor, member: MemberId, id?: StravaActivityId): Promise<void> {
  await db.execute(sql`DELETE FROM strava_jobs WHERE member_id = ${member} ${id === undefined ? sql`` : sql`AND strava_activity_id = ${id}`}`)
}
