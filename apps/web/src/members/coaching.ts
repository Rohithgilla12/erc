import { sql } from '@payloadcms/db-postgres/drizzle'
import {
  ownedBy,
  type AthleteWeekView,
  type CoachingCoach,
  type CoachReviewView,
  type CoachRosterItem,
  type CoachRosterView,
  type MyCoachingView,
  type OwnerOnly,
  type RunView,
} from '@erc/contract'
import {
  addDays,
  CLUB_TIME_ZONE,
  err,
  ok,
  summariseWeek,
  todayIn,
  weekOf,
  type AthleteCheckIn,
  type CheckInFeeling,
  type CoachId,
  type CoachingDecision,
  type CoachingLink,
  type CoachingLinkEndedBy,
  type CoachingLinkState,
  type LocalDate,
  type MemberId,
  type PublicSource,
  type Result,
  type Slug,
  type WeekReviewInput,
} from '@erc/domain'
import type { Payload } from 'payload'

import { instantOf } from './session'
import type { OpFailure } from './run'

function asStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(String)
    } catch {
      return []
    }
  }
  return []
}

export async function getMyCoaching(
  payload: Payload,
  memberId: MemberId,
): Promise<Result<OwnerOnly<MyCoachingView>, OpFailure>> {
  const db = payload.db.drizzle
  const linkRes = await db.execute(sql`
    SELECT id, athlete_member_id, coach_id, state, requested_at, decided_at, ended_at, ended_by
    FROM coaching_links
    WHERE athlete_member_id = ${memberId} AND state IN ('requested', 'active')
    ORDER BY requested_at DESC
    LIMIT 1
  `)
  const linkRow = linkRes.rows[0] as
    | {
        id: string
        athlete_member_id: number
        coach_id: number
        state: CoachingLinkState
        requested_at: Date | string
        decided_at: Date | string | null
        ended_at: Date | string | null
        ended_by: CoachingLinkEndedBy | null
      }
    | undefined

  if (!linkRow) {
    const availableRes = await db.execute(sql`
      SELECT c.id, c.name, c.slug, c.credentials, m.url AS photo_url
      FROM coaches c
      LEFT JOIN media m ON m.id = c.photo_id
      WHERE c._status = 'published'
      ORDER BY c.name ASC
    `)
    const availableCoaches: CoachingCoach[] = (
      availableRes.rows as { id: number; name: string; slug: string; credentials: string; photo_url: string | null }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      credentials: r.credentials,
      photoUrl: r.photo_url ?? null,
    }))
    return ok(
      ownedBy(memberId, {
        link: null,
        coach: null,
        availableCoaches,
        currentReview: null,
      }),
    )
  }

  const link: CoachingLink = {
    id: linkRow.id,
    athleteMember: linkRow.athlete_member_id as MemberId,
    coachId: linkRow.coach_id as CoachId,
    state: linkRow.state,
    requestedAt: instantOf(linkRow.requested_at),
    decidedAt: linkRow.decided_at ? instantOf(linkRow.decided_at) : null,
    endedAt: linkRow.ended_at ? instantOf(linkRow.ended_at) : null,
    endedBy: linkRow.ended_by,
  }

  const coachRes = await db.execute(sql`
    SELECT c.id, c.name, c.slug, c.credentials, m.url AS photo_url
    FROM coaches c
    LEFT JOIN media m ON m.id = c.photo_id
    WHERE c.id = ${linkRow.coach_id}
    LIMIT 1
  `)
  const coachRow = coachRes.rows[0] as
    | { id: number; name: string; slug: string; credentials: string; photo_url: string | null }
    | undefined
  const coach: CoachingCoach | null = coachRow
    ? {
        id: coachRow.id,
        name: coachRow.name,
        slug: coachRow.slug,
        credentials: coachRow.credentials,
        photoUrl: coachRow.photo_url ?? null,
      }
    : null

  let currentReview: CoachReviewView | null = null
  if (linkRow.state === 'active') {
    const reviewRes = await db.execute(sql`
      SELECT week_start_date::text AS week_start, watch, recommendations, note, shared_at
      FROM week_reviews
      WHERE link_id = ${linkRow.id}
      ORDER BY week_start_date DESC
      LIMIT 1
    `)
    const reviewRow = reviewRes.rows[0] as
      | {
          week_start: string
          watch: unknown
          recommendations: unknown
          note: string | null
          shared_at: Date | string
        }
      | undefined
    if (reviewRow) {
      currentReview = {
        weekStart: reviewRow.week_start,
        watch: asStringArray(reviewRow.watch),
        recommendations: asStringArray(reviewRow.recommendations),
        note: reviewRow.note ?? null,
        sharedAt: instantOf(reviewRow.shared_at),
      }
    }
  }

  return ok(
    ownedBy(memberId, {
      link,
      coach,
      currentReview,
    }),
  )
}

export async function requestCoach(
  payload: Payload,
  memberId: MemberId,
  coachId: CoachId,
): Promise<Result<OwnerOnly<{ requested: true }>, OpFailure>> {
  const db = payload.db.drizzle
  const coachRes = await db.execute(sql`SELECT id FROM coaches WHERE id = ${coachId} AND _status = 'published' LIMIT 1`)
  if (coachRes.rows.length === 0) {
    return err({ code: 'not_found', message: 'Coach not found.' })
  }

  const existingRes = await db.execute(sql`
    SELECT id, state FROM coaching_links
    WHERE athlete_member_id = ${memberId} AND state IN ('requested', 'active')
    LIMIT 1
  `)
  if (existingRes.rows.length > 0) {
    return err({ code: 'conflict', message: 'You already have an active coach or pending coaching request.' })
  }

  try {
    await db.execute(sql`
      INSERT INTO coaching_links (athlete_member_id, coach_id, state)
      VALUES (${memberId}, ${coachId}, 'requested')
    `)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('coaching_links_active_athlete_idx') || (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505')) {
      return err({ code: 'conflict', message: 'You already have an active coach or pending coaching request.' })
    }
    throw error
  }

  return ok(ownedBy(memberId, { requested: true }))
}

export async function endCoaching(
  payload: Payload,
  memberId: MemberId,
  endedBy: CoachingLinkEndedBy,
): Promise<Result<OwnerOnly<{ ended: true }>, OpFailure>> {
  const db = payload.db.drizzle
  const { rows } = await db.execute(sql`
    UPDATE coaching_links
    SET state = 'ended', ended_at = now(), ended_by = ${endedBy}
    WHERE athlete_member_id = ${memberId} AND state IN ('requested', 'active')
    RETURNING id
  `)
  if (rows.length === 0) {
    return err({ code: 'not_found', message: 'No active coaching relationship found.' })
  }
  return ok(ownedBy(memberId, { ended: true }))
}

export async function submitCheckIn(
  payload: Payload,
  memberId: MemberId,
  input: AthleteCheckIn,
  weekStart?: LocalDate | null,
): Promise<Result<OwnerOnly<AthleteCheckIn>, OpFailure>> {
  const db = payload.db.drizzle
  const targetWeekStart = weekOf(weekStart ?? todayIn(CLUB_TIME_ZONE)).first
  const { rows } = await db.execute(sql`
    INSERT INTO check_ins (member_id, week_start_date, feeling, niggles, note, submitted_at)
    VALUES (${memberId}, ${targetWeekStart}, ${input.feeling}, ${input.niggles ?? null}, ${input.note ?? null}, now())
    ON CONFLICT (member_id, week_start_date)
    DO UPDATE SET feeling = EXCLUDED.feeling, niggles = EXCLUDED.niggles, note = EXCLUDED.note, submitted_at = now()
    RETURNING member_id, week_start_date::text AS week_start_date, feeling, niggles, note, submitted_at
  `)
  const row = rows[0] as {
    member_id: number
    week_start_date: string
    feeling: CheckInFeeling
    niggles: string | null
    note: string | null
    submitted_at: Date | string
  }
  return ok(
    ownedBy(memberId, {
      feeling: row.feeling,
      niggles: row.niggles,
      note: row.note,
      submittedAt: instantOf(row.submitted_at),
    }),
  )
}

export async function getMyWeekReview(
  payload: Payload,
  memberId: MemberId,
  weekStart?: LocalDate | null,
): Promise<Result<CoachReviewView | null, OpFailure>> {
  const db = payload.db.drizzle
  const targetWeekStart = weekOf(weekStart ?? todayIn(CLUB_TIME_ZONE)).first

  const linkRes = await db.execute(sql`
    SELECT id FROM coaching_links
    WHERE athlete_member_id = ${memberId} AND state = 'active'
    LIMIT 1
  `)
  const linkRow = linkRes.rows[0] as { id: string } | undefined
  if (!linkRow) return ok(null)

  const reviewRes = await db.execute(sql`
    SELECT week_start_date::text AS week_start, watch, recommendations, note, shared_at
    FROM week_reviews
    WHERE link_id = ${linkRow.id} AND week_start_date = ${targetWeekStart}
    LIMIT 1
  `)
  const reviewRow = reviewRes.rows[0] as
    | {
        week_start: string
        watch: unknown
        recommendations: unknown
        note: string | null
        shared_at: Date | string
      }
    | undefined
  if (!reviewRow) return ok(null)

  return ok({
    weekStart: reviewRow.week_start,
    watch: asStringArray(reviewRow.watch),
    recommendations: asStringArray(reviewRow.recommendations),
    note: reviewRow.note ?? null,
    sharedAt: instantOf(reviewRow.shared_at),
  })
}

export async function getCoachRoster(
  payload: Payload,
  coachId: CoachId,
): Promise<Result<CoachRosterView, OpFailure>> {
  const db = payload.db.drizzle
  const coachRes = await db.execute(sql`SELECT id, name, slug FROM coaches WHERE id = ${coachId} LIMIT 1`)
  const coachRow = coachRes.rows[0] as { id: number; name: string; slug: string } | undefined
  if (!coachRow) {
    return err({ code: 'forbidden', message: 'Coach profile not found.' })
  }

  const linksRes = await db.execute(sql`
    SELECT id, athlete_member_id, state, requested_at
    FROM coaching_links
    WHERE coach_id = ${coachId} AND state IN ('requested', 'active')
    ORDER BY requested_at DESC
  `)
  type LinkRow = { id: string; athlete_member_id: number; state: CoachingLinkState; requested_at: Date | string }
  const linkRows = linksRes.rows as LinkRow[]

  if (linkRows.length === 0) {
    return ok({
      coach: { id: coachRow.id, name: coachRow.name, slug: coachRow.slug },
      pendingRequests: [],
      athletes: [],
    })
  }

  const memberIds = [...new Set(linkRows.map((l) => l.athlete_member_id))]

  const athletesRes = await db.execute(sql`
    SELECT a.id, a.name, a.slug, a.member_id, m.url AS photo_url
    FROM athletes a
    LEFT JOIN media m ON m.id = a.photo_id
    WHERE a.member_id IN ${sql`(${sql.join(memberIds.map((id) => sql`${id}`), sql`, `)})`}
  `)
  type AthleteDbRow = { id: number; name: string; slug: string; member_id: number; photo_url: string | null }
  const athleteMap = new Map<number, AthleteDbRow>()
  for (const row of athletesRes.rows as AthleteDbRow[]) {
    athleteMap.set(row.member_id, row)
  }

  const today = todayIn(CLUB_TIME_ZONE)
  const thisWeek = weekOf(today)
  const prevWeekStart = addDays(thisWeek.first, -7)
  const prevWeek = { kind: 'week' as const, first: prevWeekStart, last: addDays(prevWeekStart, 6) }

  const activeLinks = linkRows.filter((l) => l.state === 'active')
  const activeMemberIds = [...new Set(activeLinks.map((l) => l.athlete_member_id))]
  const activeLinkIds = activeLinks.map((l) => l.id)

  type ActivityRow = {
    member_id: number
    source: PublicSource
    ref: string
    on: string
    date: string
    metres: number
    distance: number
    moving: number
    seconds: number
    logged_at: Date | string
    note: string | null
  }
  const activitiesByMember = new Map<number, ActivityRow[]>()

  type CheckInRow = {
    member_id: number
    feeling: CheckInFeeling
    niggles: string | null
    note: string | null
    submitted_at: Date | string
  }
  const checkInsByMember = new Map<number, AthleteCheckIn>()
  const reviewsByLinkId = new Set<string>()

  if (activeMemberIds.length > 0) {
    const actRes = await db.execute(sql`
      SELECT member_id, source, ref, on_date::text AS on, on_date::text AS date, metres, metres AS distance, moving_s AS moving, moving_s AS seconds, logged_at, note
      FROM activities
      WHERE member_id IN ${sql`(${sql.join(activeMemberIds.map((id) => sql`${id}`), sql`, `)})`}
        AND source IN ('manual', 'file')
        AND on_date BETWEEN ${prevWeek.first} AND ${thisWeek.last}
      ORDER BY on_date DESC, logged_at DESC
    `)
    for (const act of actRes.rows as ActivityRow[]) {
      const list = activitiesByMember.get(act.member_id) ?? []
      list.push(act)
      activitiesByMember.set(act.member_id, list)
    }

    const checkRes = await db.execute(sql`
      SELECT member_id, feeling, niggles, note, submitted_at
      FROM check_ins
      WHERE member_id IN ${sql`(${sql.join(activeMemberIds.map((id) => sql`${id}`), sql`, `)})`}
        AND week_start_date = ${thisWeek.first}
    `)
    for (const c of checkRes.rows as CheckInRow[]) {
      checkInsByMember.set(c.member_id, {
        feeling: c.feeling,
        niggles: c.niggles,
        note: c.note,
        submittedAt: instantOf(c.submitted_at),
      })
    }

    if (activeLinkIds.length > 0) {
      const revRes = await db.execute(sql`
        SELECT link_id FROM week_reviews
        WHERE link_id IN ${sql`(${sql.join(activeLinkIds.map((id) => sql`${id}`), sql`, `)})`}
          AND week_start_date = ${thisWeek.first}
      `)
      for (const r of revRes.rows as { link_id: string }[]) {
        reviewsByLinkId.add(r.link_id)
      }
    }
  }

  const pendingRequests: CoachRosterItem[] = []
  const athletes: CoachRosterItem[] = []

  for (const link of linkRows) {
    const athlete = athleteMap.get(link.athlete_member_id)
    const athleteName = athlete?.name ?? `Member #${link.athlete_member_id}`
    const athleteSlug = athlete?.slug ?? ''
    const athletePhotoUrl = athlete?.photo_url ?? null

    if (link.state === 'requested') {
      pendingRequests.push({
        linkId: link.id,
        athleteMember: String(link.athlete_member_id),
        athleteName,
        athleteSlug,
        athletePhotoUrl,
        totalMetres: 0,
        totalSeconds: 0,
        runCount: 0,
        flags: [],
        checkIn: null,
        hasReview: false,
        state: 'requested',
        requestedAt: instantOf(link.requested_at),
      })
    } else if (link.state === 'active') {
      const allRuns = activitiesByMember.get(link.athlete_member_id) ?? []
      const thisWeekRuns = allRuns.filter((r) => r.on >= thisWeek.first && r.on <= thisWeek.last)
      const prevWeekRuns = allRuns.filter((r) => r.on >= prevWeek.first && r.on <= prevWeek.last)
      const checkIn = checkInsByMember.get(link.athlete_member_id) ?? null
      const summary = summariseWeek(thisWeekRuns, prevWeekRuns, checkIn)
      const hasReview = reviewsByLinkId.has(link.id)

      athletes.push({
        linkId: link.id,
        athleteMember: String(link.athlete_member_id),
        athleteName,
        athleteSlug,
        athletePhotoUrl,
        totalMetres: summary.totalMetres,
        totalSeconds: summary.totalSeconds,
        runCount: summary.runCount,
        flags: summary.flags,
        checkIn,
        hasReview,
        state: 'active',
        requestedAt: instantOf(link.requested_at),
      })
    }
  }

  return ok({
    coach: { id: coachRow.id, name: coachRow.name, slug: coachRow.slug },
    pendingRequests,
    athletes,
  })
}

export async function decideRequest(
  payload: Payload,
  coachId: CoachId,
  linkId: string,
  decision: CoachingDecision,
): Promise<Result<{ decided: true }, OpFailure>> {
  const db = payload.db.drizzle
  const linkRes = await db.execute(sql`
    SELECT id, coach_id, state FROM coaching_links WHERE id = ${linkId}
  `)
  const linkRow = linkRes.rows[0] as { id: string; coach_id: number; state: CoachingLinkState } | undefined
  if (!linkRow || linkRow.coach_id !== coachId) {
    return err({ code: 'not_found', message: 'Coaching request not found.' })
  }
  if (linkRow.state !== 'requested') {
    return err({ code: 'conflict', message: 'This coaching request has already been decided.' })
  }

  if (decision === 'accept') {
    const res = await db.execute(sql`
      UPDATE coaching_links SET state = 'active', decided_at = now()
      WHERE id = ${linkId} AND coach_id = ${coachId} AND state = 'requested'
    `)
    if ((res.rowCount ?? 0) === 0) {
      return err({ code: 'conflict', message: 'This coaching request has already been decided.' })
    }
  } else {
    const res = await db.execute(sql`
      UPDATE coaching_links SET state = 'ended', decided_at = now(), ended_at = now(), ended_by = 'coach'
      WHERE id = ${linkId} AND coach_id = ${coachId} AND state = 'requested'
    `)
    if ((res.rowCount ?? 0) === 0) {
      return err({ code: 'conflict', message: 'This coaching request has already been decided.' })
    }
  }

  return ok({ decided: true })
}

export async function getAthleteWeek(
  payload: Payload,
  coachId: CoachId,
  athleteSlug: Slug,
  weekStart?: LocalDate | null,
): Promise<Result<AthleteWeekView, OpFailure>> {
  const db = payload.db.drizzle
  const targetWeekStart = weekOf(weekStart ?? todayIn(CLUB_TIME_ZONE)).first
  const thisWeek = { kind: 'week' as const, first: targetWeekStart, last: addDays(targetWeekStart, 6) }
  const prevWeekStart = addDays(targetWeekStart, -7)
  const prevWeek = { kind: 'week' as const, first: prevWeekStart, last: addDays(prevWeekStart, 6) }

  const athleteRes = await db.execute(sql`
    SELECT a.id, a.name, a.slug, a.member_id, m.url AS photo_url
    FROM athletes a
    LEFT JOIN media m ON m.id = a.photo_id
    WHERE a.slug = ${athleteSlug}
    LIMIT 1
  `)
  const athleteRow = athleteRes.rows[0] as
    | { id: number; name: string; slug: string; member_id: number | null; photo_url: string | null }
    | undefined
  if (!athleteRow) {
    return err({ code: 'not_found', message: 'Athlete not found.' })
  }
  if (!athleteRow.member_id) {
    return err({ code: 'not_found', message: 'Athlete profile has no associated member.' })
  }

  const linkRes = await db.execute(sql`
    SELECT id FROM coaching_links
    WHERE coach_id = ${coachId} AND athlete_member_id = ${athleteRow.member_id} AND state = 'active'
    LIMIT 1
  `)
  const linkRow = linkRes.rows[0] as { id: string } | undefined
  if (!linkRow) {
    return err({ code: 'forbidden', message: 'You are not the designated coach for this athlete.' })
  }

  type ActivityRow = {
    member_id: number
    source: PublicSource
    ref: string
    on_date: string
    metres: number
    moving_s: number
    logged_at: Date | string
    note: string | null
  }
  const actRes = await db.execute(sql`
    SELECT member_id, source, ref, on_date::text AS on_date, metres, moving_s, logged_at, note
    FROM activities
    WHERE member_id = ${athleteRow.member_id}
      AND source IN ('manual', 'file')
      AND on_date BETWEEN ${prevWeek.first} AND ${thisWeek.last}
    ORDER BY on_date DESC, logged_at DESC
  `)
  const allRuns = actRes.rows as ActivityRow[]
  const thisWeekRows = allRuns.filter((r) => r.on_date >= thisWeek.first && r.on_date <= thisWeek.last)
  const prevWeekRows = allRuns.filter((r) => r.on_date >= prevWeek.first && r.on_date <= prevWeek.last)

  const checkRes = await db.execute(sql`
    SELECT feeling, niggles, note, submitted_at
    FROM check_ins
    WHERE member_id = ${athleteRow.member_id} AND week_start_date = ${thisWeek.first}
    LIMIT 1
  `)
  const checkRow = checkRes.rows[0] as
    | {
        feeling: CheckInFeeling
        niggles: string | null
        note: string | null
        submitted_at: Date | string
      }
    | undefined
  const checkIn: AthleteCheckIn | null = checkRow
    ? {
        feeling: checkRow.feeling,
        niggles: checkRow.niggles,
        note: checkRow.note,
        submittedAt: instantOf(checkRow.submitted_at),
      }
    : null

  const runs: RunView[] = thisWeekRows.map((r) => ({
    source: r.source,
    ref: r.ref,
    on: r.on_date,
    distance: r.metres,
    moving: r.moving_s,
    loggedAt: instantOf(r.logged_at),
    ...(r.note !== null && r.note !== undefined ? { note: r.note } : {}),
  }))

  const prevRuns: RunView[] = prevWeekRows.map((r) => ({
    source: r.source,
    ref: r.ref,
    on: r.on_date,
    distance: r.metres,
    moving: r.moving_s,
    loggedAt: instantOf(r.logged_at),
  }))

  const summary = summariseWeek(runs, prevRuns, checkIn)

  const revRes = await db.execute(sql`
    SELECT week_start_date::text AS week_start, watch, recommendations, note, shared_at
    FROM week_reviews
    WHERE link_id = ${linkRow.id} AND week_start_date = ${thisWeek.first}
    LIMIT 1
  `)
  const revRow = revRes.rows[0] as
    | {
        week_start: string
        watch: unknown
        recommendations: unknown
        note: string | null
        shared_at: Date | string
      }
    | undefined
  const review: CoachReviewView | null = revRow
    ? {
        weekStart: revRow.week_start,
        watch: asStringArray(revRow.watch),
        recommendations: asStringArray(revRow.recommendations),
        note: revRow.note ?? null,
        sharedAt: instantOf(revRow.shared_at),
      }
    : null

  return ok({
    athlete: {
      id: athleteRow.id,
      slug: athleteRow.slug,
      name: athleteRow.name,
      photoUrl: athleteRow.photo_url ?? null,
    },
    weekStart: thisWeek.first,
    runs,
    checkIn,
    summary,
    review,
  })
}

export async function saveWeekReview(
  payload: Payload,
  coachId: CoachId,
  athleteSlug: Slug,
  weekStart: LocalDate,
  input: WeekReviewInput,
): Promise<Result<CoachReviewView, OpFailure>> {
  const db = payload.db.drizzle
  const targetWeekStart = weekOf(weekStart).first

  const athleteRes = await db.execute(sql`
    SELECT id, member_id FROM athletes WHERE slug = ${athleteSlug} LIMIT 1
  `)
  const athleteRow = athleteRes.rows[0] as { id: number; member_id: number | null } | undefined
  if (!athleteRow) {
    return err({ code: 'not_found', message: 'Athlete not found.' })
  }
  if (!athleteRow.member_id) {
    return err({ code: 'not_found', message: 'Athlete profile has no associated member.' })
  }

  const linkRes = await db.execute(sql`
    SELECT id FROM coaching_links
    WHERE coach_id = ${coachId} AND athlete_member_id = ${athleteRow.member_id} AND state = 'active'
    LIMIT 1
  `)
  const linkRow = linkRes.rows[0] as { id: string } | undefined
  if (!linkRow) {
    return err({ code: 'forbidden', message: 'You are not the designated coach for this athlete.' })
  }

  const { rows } = await db.execute(sql`
    INSERT INTO week_reviews (link_id, week_start_date, watch, recommendations, note, shared_at)
    VALUES (
      ${linkRow.id},
      ${targetWeekStart},
      ${JSON.stringify(input.watch ?? [])}::jsonb,
      ${JSON.stringify(input.recommendations ?? [])}::jsonb,
      ${input.note ?? null},
      now()
    )
    ON CONFLICT (link_id, week_start_date)
    DO UPDATE SET
      watch = EXCLUDED.watch,
      recommendations = EXCLUDED.recommendations,
      note = EXCLUDED.note,
      shared_at = now()
    RETURNING link_id, week_start_date::text AS week_start, watch, recommendations, note, shared_at
  `)

  const row = rows[0] as {
    link_id: string
    week_start: string
    watch: unknown
    recommendations: unknown
    note: string | null
    shared_at: Date | string
  }

  return ok({
    weekStart: row.week_start,
    watch: asStringArray(row.watch),
    recommendations: asStringArray(row.recommendations),
    note: row.note ?? null,
    sharedAt: instantOf(row.shared_at),
  })
}
