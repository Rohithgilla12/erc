import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  overBudget,
  parseRateLimits,
  parseStravaDetail,
  parseStravaStreams,
  STREAM_KEYS,
  stravaRef,
  type MemberId,
  type StravaActivityId,
} from '@erc/domain'
import type { Payload } from 'payload'

import { writeDetail, writeStreams, type Executor } from './run-metrics'
import { getValidStravaToken, writeStravaRun } from './strava'
import { queueMissingStravaWork, type StravaJobKind } from './strava-jobs'

const API = 'https://www.strava.com/api/v3'

/** A job that has failed this many times is dropped; the next list sync queues it again if the run is still missing data. */
export const MAX_JOB_ATTEMPTS = 5
/** 80 is 80% of Strava's 100 reads per 15 minutes, the cap when its headers say nothing. */
export const MAX_REQUESTS_PER_DRAIN = 80
/** Long enough for any one job to finish; a drain that dies mid-job leaves it claimable again after this. */
const LEASE = sql`interval '5 minutes'`

export type DrainStop = 'empty' | 'budget' | 'rate_limited' | 'request_cap'
export type DrainReport = { requests: number; done: number; retried: number; dropped: number; stopped: DrainStop }

type Job = { id: string; member: MemberId; activity: StravaActivityId; kind: StravaJobKind; attempts: number; enqueuedAt: string }

/** What became of one claimed job. `release` hands it back untouched, for failures that are not the job's fault. */
type Outcome = { kind: 'done' } | { kind: 'drop'; reason: string } | { kind: 'retry'; error: string } | { kind: 'release' }

/**
 * Leases the oldest due job of a connected member. Detail jobs come first, and a streams job waits while its activity
 * still has a detail job, because streams are stored against the run the detail fetch creates. SKIP LOCKED and the
 * lease let two drains run at once without taking the same job.
 */
async function claim(db: Executor): Promise<Job | null> {
  const { rows } = await db.execute(sql`
    UPDATE strava_jobs SET not_before = now() + ${LEASE}
    WHERE id = (
      SELECT j.id FROM strava_jobs j
      JOIN strava_connections c ON c.member_id = j.member_id AND c.status = 'connected'
      WHERE j.not_before <= now()
        AND (j.kind = 'detail' OR NOT EXISTS (SELECT 1 FROM strava_jobs d WHERE d.kind = 'detail' AND d.strava_activity_id = j.strava_activity_id))
      ORDER BY j.kind = 'streams', j.enqueued_at, j.id
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED
    )
    RETURNING id::text, member_id, strava_activity_id::text, kind, attempts, enqueued_at::text`)
  const row = rows[0] as { id: string; member_id: number; strava_activity_id: string; kind: StravaJobKind; attempts: number; enqueued_at: string } | undefined
  return row
    ? { id: row.id, member: row.member_id as MemberId, activity: Number(row.strava_activity_id) as StravaActivityId, kind: row.kind, attempts: row.attempts, enqueuedAt: row.enqueued_at }
    : null
}

// The enqueued_at guard keeps a job a webhook requeued while this one was in flight.
const finish = (db: Executor, job: Job) => db.execute(sql`DELETE FROM strava_jobs WHERE id = ${job.id} AND enqueued_at::text = ${job.enqueuedAt}`)

async function settle(db: Executor, job: Job, outcome: Outcome): Promise<'done' | 'retried' | 'dropped' | null> {
  switch (outcome.kind) {
    case 'done':
      await finish(db, job)
      return 'done'
    case 'drop':
      console.warn(`Dropping Strava ${job.kind} job for activity ${job.activity}: ${outcome.reason}`)
      await finish(db, job)
      return 'dropped'
    case 'retry':
      if (job.attempts + 1 >= MAX_JOB_ATTEMPTS) return settle(db, job, { kind: 'drop', reason: `gave up after ${MAX_JOB_ATTEMPTS} attempts: ${outcome.error}` })
      await db.execute(sql`
        UPDATE strava_jobs
        SET attempts = attempts + 1, last_error = ${outcome.error.slice(0, 500)}, not_before = now() + interval '15 minutes' * power(2, attempts)
        WHERE id = ${job.id} AND enqueued_at::text = ${job.enqueuedAt}`)
      return 'retried'
    case 'release':
      await db.execute(sql`UPDATE strava_jobs SET not_before = now() WHERE id = ${job.id} AND enqueued_at::text = ${job.enqueuedAt}`)
      return null
  }
}

const pathOf = (job: Job) =>
  job.kind === 'detail' ? `${API}/activities/${job.activity}?include_all_efforts=false` : `${API}/activities/${job.activity}/streams?keys=${STREAM_KEYS.join(',')}&key_by_type=true`

/** Stores a fetched body. Every write is an upsert or a replace, so a job retried after a crash converges. */
async function store(payload: Payload, job: Job, body: unknown): Promise<Outcome> {
  const db = payload.db.drizzle
  const ref = stravaRef(job.activity)
  if (job.kind === 'detail') {
    const parsed = parseStravaDetail(body, job.member)
    if (!parsed.ok) {
      // An activity re-typed from a run to something else leaves the club log, metrics and all.
      if (parsed.error === 'not_a_run') await db.execute(sql`DELETE FROM activities WHERE member_id = ${job.member} AND source = 'strava' AND ref = ${ref}`)
      return { kind: 'drop', reason: parsed.error }
    }
    await db.transaction(async (tx) => {
      await writeStravaRun(tx, parsed.value)
      await writeDetail(tx, { member: job.member, source: 'strava', ref }, parsed.value.detail)
      await queueMissingStravaWork(tx, job.member, [job.activity])
    })
    return { kind: 'done' }
  }
  const streams = parseStravaStreams(body)
  if (!streams.ok) return { kind: 'drop', reason: streams.error }
  const { rows } = await db.execute(sql`SELECT 1 FROM activities WHERE member_id = ${job.member} AND source = 'strava' AND ref = ${ref}`)
  if (rows.length === 0) return { kind: 'drop', reason: 'no run stored for these streams' }
  await writeStreams(db, { member: job.member, source: 'strava', ref }, streams.value)
  return { kind: 'done' }
}

/**
 * Works through due jobs one request at a time until the queue is empty or the budget is spent. Strava's rate-limit
 * headers are read after every response and the run stops once any window reaches 80%; a 429 stops it at once and
 * hands the job back without counting an attempt.
 */
export async function drainStravaJobs(payload: Payload, maxRequests = MAX_REQUESTS_PER_DRAIN): Promise<DrainReport> {
  const db = payload.db.drizzle
  const report: DrainReport = { requests: 0, done: 0, retried: 0, dropped: 0, stopped: 'empty' }
  const tokens = new Map<MemberId, string | null>()
  const tally = (result: 'done' | 'retried' | 'dropped' | null) => {
    if (result) report[result]++
  }

  while (true) {
    if (report.requests >= maxRequests) return { ...report, stopped: 'request_cap' }
    const job = await claim(db)
    if (!job) return report

    if (!tokens.has(job.member)) tokens.set(job.member, await getValidStravaToken(payload, job.member))
    const token = tokens.get(job.member)
    if (!token) {
      tally(await settle(db, job, { kind: 'retry', error: 'no valid Strava token' }))
      continue
    }

    let response: Response
    try {
      report.requests++
      response = await fetch(pathOf(job), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    } catch (error) {
      tally(await settle(db, job, { kind: 'retry', error: error instanceof Error ? error.message : 'network error' }))
      continue
    }

    if (response.status === 429) {
      await settle(db, job, { kind: 'release' })
      return { ...report, stopped: 'rate_limited' }
    }

    let outcome: Outcome
    if (response.status === 401) {
      await db.execute(sql`UPDATE strava_connections SET status = 'disconnected', updated_at = now() WHERE member_id = ${job.member}`)
      tokens.set(job.member, null)
      outcome = { kind: 'release' }
    } else if (response.status === 404) {
      // Deleted on Strava, or made private and so outside what the athlete shared with us: either way it goes.
      if (job.kind === 'detail') await db.execute(sql`DELETE FROM activities WHERE member_id = ${job.member} AND source = 'strava' AND ref = ${stravaRef(job.activity)}`)
      outcome = { kind: 'drop', reason: 'not found on Strava' }
    } else if (!response.ok) {
      outcome = { kind: 'retry', error: `HTTP ${response.status}` }
    } else {
      const body: unknown = await response.json().catch(() => null)
      try {
        outcome = await store(payload, job, body)
      } catch (error) {
        outcome = { kind: 'retry', error: error instanceof Error ? error.message : 'could not store' }
      }
    }
    tally(await settle(db, job, outcome))

    if (overBudget(parseRateLimits(response.headers))) return { ...report, stopped: 'budget' }
  }
}
