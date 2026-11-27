import { sql } from '@payloadcms/db-postgres/drizzle'
import type { CoachQuestion, MyQuestion, MyReview, ProfileModeration } from '@erc/contract'
import {
  err,
  ok,
  QUESTIONS_PER_HOUR,
  REVIEWS_PER_HOUR,
  subjectKeyOf,
  type AnswerDraft,
  type CoachId,
  type Id,
  type MemberId,
  type QuestionDraft,
  type Rating,
  type Result,
  type ReviewSubject,
  type ReviewSubjectKind,
  type WriteReview,
} from '@erc/domain'
import type { Payload } from 'payload'

import { expireCollection } from '@/cms/revalidate'
import { withXactLock, type Transaction } from '@/content/xact-lock'

import { instantOf } from './session'

export type ReviewRefusal = 'no_subject' | 'already_reviewed' | 'not_yours' | 'too_many'
export type QuestionRefusal = 'no_race' | 'too_many'
export type AnswerRefusal = 'no_question' | 'answered_by_someone_else'

type Stamp = Date | string
type ModerationRow = { moderation_state: ProfileModeration['state']; moderation_reason: string | null }

const moderationOf = (row: ModerationRow): ProfileModeration =>
  row.moderation_state === 'rejected' ? { state: 'rejected', reason: row.moderation_reason ?? '' } : { state: row.moderation_state }

const rowsOf = async <T>(payload: Payload, query: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(query)).rows as T[]

/** A shoe, or an approved race: members cannot review or ask about a race the public cannot see. */
async function subjectExists(payload: Payload, subject: ReviewSubject): Promise<boolean> {
  const query =
    subject.kind === 'shoes'
      ? sql`SELECT 1 FROM shoes WHERE id = ${subject.id}`
      : sql`SELECT 1 FROM races WHERE id = ${subject.id} AND moderation_state = 'approved'`
  return (await rowsOf(payload, query)).length > 0
}

type ReviewRow = ModerationRow & {
  id: number
  kind: ReviewSubjectKind
  subject_id: number
  subject_name: string
  subject_slug: string
  rating: number
  title: string
  body: string
  km_run: number | null
  year_run: number | null
  submitted_at: Stamp
}

const reviewOf = (row: ReviewRow): MyReview => ({
  id: row.id as Id<'reviews'>,
  subject: { kind: row.kind, id: row.subject_id, name: row.subject_name, path: `/${row.kind}/${row.subject_slug}` },
  rating: row.rating as Rating,
  title: row.title,
  body: row.body,
  kmRun: row.km_run,
  yearRun: row.year_run,
  moderation: moderationOf(row),
  submittedAt: instantOf(row.submitted_at),
})

const reviewsWhere = (payload: Payload, condition: ReturnType<typeof sql>) =>
  rowsOf<ReviewRow>(
    payload,
    sql`
      SELECT r.id, r.rating::int AS rating, r.title, r.body, r.km_run::int AS km_run, r.year_run::int AS year_run,
        r.moderation_state, r.moderation_reason, coalesce(r.moderation_submitted_at, r.created_at) AS submitted_at,
        CASE WHEN rel.shoes_id IS NOT NULL THEN 'shoes' ELSE 'races' END AS kind,
        coalesce(rel.shoes_id, rel.races_id) AS subject_id,
        coalesce(s.brand || ' ' || s.model, ra.name) AS subject_name,
        coalesce(s.slug, ra.slug) AS subject_slug
      FROM reviews r
      JOIN reviews_rels rel ON rel.parent_id = r.id AND rel.path = 'subject'
      LEFT JOIN shoes s ON s.id = rel.shoes_id
      LEFT JOIN races ra ON ra.id = rel.races_id
      WHERE ${condition}
      ORDER BY r.created_at DESC`,
  )

export const myReviews = async (payload: Payload, member: MemberId): Promise<MyReview[]> => (await reviewsWhere(payload, sql`r.member_id = ${member}`)).map(reviewOf)

const reviewById = async (payload: Payload, id: number): Promise<MyReview> => {
  const [row] = await reviewsWhere(payload, sql`r.id = ${id}`)
  if (!row) throw new Error(`Review ${id} vanished after it was written`)
  return reviewOf(row)
}

const liveReviewExists = async (payload: Payload, member: MemberId, key: string) =>
  (await rowsOf(payload, sql`SELECT 1 FROM reviews WHERE member_id = ${member} AND subject_key = ${key} AND moderation_state <> 'rejected'`)).length > 0

const writtenThisHour = async (db: Transaction, table: 'reviews' | 'questions', member: MemberId) => {
  const { rows } = await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE member_id = ${member} AND created_at > now() - interval '1 hour'`)
  return (rows[0] as { n: number } | undefined)?.n ?? 0
}

/**
 * Held while a member's hourly count is read and their new row written, so parallel requests cannot all count under
 * the limit. Namespaced, so it never shares a lock with an email cap.
 */
const memberWritesLock = (member: MemberId) => `member-writes:${member}`

/**
 * A new review goes in through Payload, which writes the subject's join row; the partial unique index refuses a second
 * live review for the same subject, so two requests at once cannot both get in. An edit is plain SQL because it must
 * send the review back to "submitted", which only a staff decision may do through Payload. An edit to a review the
 * public can see expires the cached pages, since SQL runs no collection hooks.
 */
export async function writeReview(payload: Payload, member: MemberId, { review, draft }: WriteReview): Promise<Result<MyReview, ReviewRefusal>> {
  if (!(await subjectExists(payload, draft.subject))) return err('no_subject')
  const key = subjectKeyOf(draft.subject)
  const kmRun = 'kmRun' in draft ? draft.kmRun : null
  const yearRun = 'yearRun' in draft ? draft.yearRun : null
  if (review !== null) {
    const [edited] = await rowsOf<{ was: ProfileModeration['state'] }>(
      payload,
      sql`
        UPDATE reviews r SET rating = ${draft.rating}, title = ${draft.title}, body = ${draft.body}, km_run = ${kmRun}, year_run = ${yearRun},
          moderation_state = 'submitted', moderation_submitted_at = now(), moderation_decided_by_id = NULL, moderation_decided_at = NULL,
          moderation_reason = NULL, updated_at = now()
        FROM reviews prior
        WHERE r.id = prior.id AND r.id = ${review} AND r.member_id = ${member} AND r.subject_key = ${key} AND r.moderation_state <> 'rejected'
        RETURNING prior.moderation_state AS was`,
    )
    if (!edited) return err('not_yours')
    if (edited.was === 'approved') await expireCollection(payload, 'reviews')
    return ok(await reviewById(payload, review))
  }
  if (await liveReviewExists(payload, member, key)) return err('already_reviewed')
  try {
    const created = await withXactLock(payload, memberWritesLock(member), async (req, db) => {
      if ((await writtenThisHour(db, 'reviews', member)) >= REVIEWS_PER_HOUR) return null
      return payload.create({
        collection: 'reviews',
        overrideAccess: true,
        req,
        data: {
          subject: draft.subject.kind === 'shoes' ? { relationTo: 'shoes', value: draft.subject.id } : { relationTo: 'races', value: draft.subject.id },
          subjectKey: key,
          member,
          rating: draft.rating,
          title: draft.title,
          body: draft.body,
          kmRun,
          yearRun,
          moderation: { state: 'submitted' },
        },
      })
    })
    if (!created) return err('too_many')
    return ok(await reviewById(payload, created.id))
  } catch (error) {
    if (await liveReviewExists(payload, member, key)) return err('already_reviewed')
    throw error
  }
}

/** Through Payload, so a live review leaves the public pages at once. */
export async function deleteReview(payload: Payload, member: MemberId, review: Id<'reviews'>): Promise<boolean> {
  const mine = await rowsOf(payload, sql`SELECT 1 FROM reviews WHERE id = ${review} AND member_id = ${member}`)
  if (mine.length === 0) return false
  await payload.delete({ collection: 'reviews', id: review, overrideAccess: true })
  return true
}

type RaceRow = { name: string; slug: string }

export async function askQuestion(payload: Payload, member: MemberId, draft: QuestionDraft): Promise<Result<MyQuestion, QuestionRefusal>> {
  const [race] = await rowsOf<RaceRow>(payload, sql`SELECT name, slug FROM races WHERE id = ${draft.race} AND moderation_state = 'approved'`)
  if (!race) return err('no_race')
  const created = await withXactLock(payload, memberWritesLock(member), async (req, db) => {
    if ((await writtenThisHour(db, 'questions', member)) >= QUESTIONS_PER_HOUR) return null
    return payload.create({ collection: 'questions', overrideAccess: true, req, data: { race: draft.race, member, text: draft.text, moderation: { state: 'submitted' } } })
  })
  if (!created) return err('too_many')
  return ok({
    id: created.id as Id<'questions'>,
    race: { id: draft.race, name: race.name, path: `/races/${race.slug}` },
    text: created.text,
    answer: null,
    moderation: { state: 'submitted' },
    askedAt: instantOf(created.createdAt),
  })
}

type CoachQuestionRow = { id: number; text: string; answer: string | null; created_at: Stamp; race_name: string; race_slug: string; coaches_id: number | null; staff_id: number | null }

const coachQuestionOf = (coach: CoachId) => (row: CoachQuestionRow): CoachQuestion => ({
  id: row.id as Id<'questions'>,
  race: { name: row.race_name, path: `/races/${row.race_slug}` },
  text: row.text,
  answer: row.answer,
  answeredByYou: row.answer !== null && row.coaches_id === coach,
  askedAt: instantOf(row.created_at),
})

const coachQuestionsWhere = (payload: Payload, condition: ReturnType<typeof sql>) =>
  rowsOf<CoachQuestionRow>(
    payload,
    sql`
      SELECT q.id, q.text, q.answer, q.created_at, ra.name AS race_name, ra.slug AS race_slug, rel.coaches_id, rel.staff_id
      FROM questions q
      JOIN races ra ON ra.id = q.race_id
      LEFT JOIN questions_rels rel ON rel.parent_id = q.id AND rel.path = 'answeredBy'
      WHERE q.moderation_state = 'approved' AND ${condition}
      ORDER BY (q.answer IS NULL) DESC, q.created_at DESC
      LIMIT 100`,
  )

/** Approved questions, unanswered first. Questions still waiting for staff are not the coach's to see. */
export const coachQuestions = async (payload: Payload, coach: CoachId): Promise<CoachQuestion[]> => (await coachQuestionsWhere(payload, sql`true`)).map(coachQuestionOf(coach))

/**
 * A coach answers an approved question nobody has answered, or changes their own answer. One conditional UPDATE
 * decides it, so of two coaches answering at once only the first gets in. Plain SQL runs no collection hooks, so the
 * cached race pages are expired here.
 */
export async function answerQuestion(payload: Payload, coach: CoachId, draft: AnswerDraft): Promise<Result<CoachQuestion, AnswerRefusal>> {
  const answered = await payload.db.drizzle.transaction(async (db) => {
    const { rows } = await db.execute(sql`
      UPDATE questions q SET answer = ${draft.answer}, answered_at = now(), updated_at = now()
      WHERE q.id = ${draft.question} AND q.moderation_state = 'approved'
        AND (q.answer IS NULL OR EXISTS (SELECT 1 FROM questions_rels r WHERE r.parent_id = q.id AND r.path = 'answeredBy' AND r.coaches_id = ${coach}))
      RETURNING q.id`)
    if (rows.length === 0) return false
    await db.execute(sql`DELETE FROM questions_rels WHERE parent_id = ${draft.question} AND path = 'answeredBy'`)
    await db.execute(sql`INSERT INTO questions_rels (parent_id, path, coaches_id) VALUES (${draft.question}, 'answeredBy', ${coach})`)
    return true
  })
  const [current] = await coachQuestionsWhere(payload, sql`q.id = ${draft.question}`)
  if (!current) return err('no_question')
  if (!answered) return err('answered_by_someone_else')
  await expireCollection(payload, 'questions')
  return ok(coachQuestionOf(coach)(current))
}
