import { sql } from '@payloadcms/db-postgres/drizzle'
import type { AthleteIntakeView, IntakeView } from '@erc/contract'
import { CLUB_TIME_ZONE, err, ok, parseIntakeAnswers, todayIn, type CoachId, type IntakeAnswers, type IntakeSubmission, type MemberId, type Result, type Slug } from '@erc/domain'
import type { Payload } from 'payload'

import { IntakeQueryFailed, sqlStateOf } from './query-error'
import type { OpFailure } from './run'
import { instantOf } from './session'

/** Every intake query runs through here, so a failed one cannot carry the answers into a log in its message. */
const execute = (payload: Payload, query: ReturnType<typeof sql>) =>
  payload.db.drizzle.execute(query).catch((error: unknown) => {
    throw new IntakeQueryFailed(sqlStateOf(error))
  })

type IntakeRow = { answers: unknown; share_with_coach: boolean; consented_at: Date | string; updated_at: Date | string }

/**
 * Stored answers go through the same parser as a new submission. A row that no longer parses, because a question
 * changed since it was saved, reads as no intake: the member takes it again and the save overwrites the row.
 */
const answersOf = (payload: Payload, member: number, stored: unknown): IntakeAnswers | null => {
  const parsed = parseIntakeAnswers(stored, todayIn(CLUB_TIME_ZONE))
  if (parsed.ok) return parsed.value
  payload.logger.warn({ member, fields: Object.keys(parsed.error) }, 'A stored intake no longer parses')
  return null
}

const viewOf = (answers: IntakeAnswers, row: IntakeRow): IntakeView => ({
  answers,
  shareWithCoach: row.share_with_coach,
  consentedAt: instantOf(row.consented_at),
  updatedAt: instantOf(row.updated_at),
})

export async function readIntake(payload: Payload, member: MemberId): Promise<IntakeView | null> {
  const { rows } = await execute(payload, sql`
    SELECT answers, share_with_coach, consented_at, updated_at FROM intakes WHERE member_id = ${member}
  `)
  const row = rows[0] as IntakeRow | undefined
  const answers = row ? answersOf(payload, member, row.answers) : null
  return row && answers ? viewOf(answers, row) : null
}

export async function saveIntake(payload: Payload, member: MemberId, input: IntakeSubmission): Promise<IntakeView> {
  const { rows } = await execute(payload, sql`
    INSERT INTO intakes (member_id, answers, share_with_coach, consented_at, updated_at)
    VALUES (${member}, ${JSON.stringify(input.answers)}::jsonb, ${input.shareWithCoach}, now(), now())
    ON CONFLICT (member_id) DO UPDATE
      SET answers = EXCLUDED.answers, share_with_coach = EXCLUDED.share_with_coach, consented_at = now(), updated_at = now()
    RETURNING share_with_coach, consented_at, updated_at
  `)
  return viewOf(input.answers, { ...(rows[0] as Omit<IntakeRow, 'answers'>), answers: input.answers })
}

export async function clearIntake(payload: Payload, member: MemberId): Promise<void> {
  await execute(payload, sql`DELETE FROM intakes WHERE member_id = ${member}`)
}

/**
 * The coach's read. One query decides it: the intake joins only through an active link from this coach and only when
 * the athlete shares it, so turning sharing off or ending the link hides it on the next read.
 */
export async function readAthleteIntake(payload: Payload, coachId: CoachId, athleteSlug: Slug): Promise<Result<AthleteIntakeView, OpFailure>> {
  const { rows } = await execute(payload, sql`
    SELECT a.member_id, l.id AS link_id, i.answers, i.updated_at
    FROM athletes a
    LEFT JOIN coaching_links l ON l.athlete_member_id = a.member_id AND l.coach_id = ${coachId} AND l.state = 'active'
    LEFT JOIN intakes i ON i.member_id = l.athlete_member_id AND i.share_with_coach
    WHERE a.slug = ${athleteSlug}
    LIMIT 1
  `)
  const row = rows[0] as { member_id: number | null; link_id: string | null; answers: unknown; updated_at: Date | string | null } | undefined
  if (!row || row.member_id === null) return err({ code: 'not_found', message: 'Athlete not found.' })
  if (row.link_id === null) return err({ code: 'forbidden', message: 'You are not the designated coach for this athlete.' })
  const answers = row.answers === null ? null : answersOf(payload, row.member_id, row.answers)
  return ok(answers && row.updated_at ? { shared: true, answers, updatedAt: instantOf(row.updated_at) } : { shared: false })
}
