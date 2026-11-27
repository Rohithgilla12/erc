import { collect, firstOf, optional, textBetween, type FieldErrors, type FieldResult } from './form-fields'
import type { RawInput } from './members'
import { err, ok, type Id, type LocalDate, type Result } from './primitives'

export const SHOE_CATEGORIES = [
  { key: 'road-daily', label: 'Road, daily' },
  { key: 'road-tempo', label: 'Road, tempo' },
  { key: 'racing', label: 'Racing' },
  { key: 'trail', label: 'Trail' },
] as const
export type ShoeCategory = (typeof SHOE_CATEGORIES)[number]['key']

export const parseShoeCategory = (raw: unknown): ShoeCategory | null => SHOE_CATEGORIES.find(({ key }) => key === firstOf(raw))?.key ?? null

/** What a review is about. The collection stores it as a polymorphic relationship, so exactly one subject is set. */
export type ReviewSubject = { kind: 'shoes'; id: Id<'shoes'> } | { kind: 'races'; id: Id<'races'> }
export type ReviewSubjectKind = ReviewSubject['kind']

/**
 * One text key per subject, stored beside the relationship so a partial unique index can hold "one review per member
 * per subject": the relationship itself lives in a separate table that an index on `reviews` cannot see.
 */
export const subjectKeyOf = (subject: ReviewSubject): string => `${subject.kind}:${subject.id}`

export type Rating = 1 | 2 | 3 | 4 | 5

export const REVIEW_TITLE_MAX = 120
export const REVIEW_BODY_MAX = 2000
export const QUESTION_MAX = 500
export const ANSWER_MAX = 2000
/** Reviews and questions one member may send in an hour: enough for anyone writing honestly, too few to flood the queue. */
export const REVIEWS_PER_HOUR = 10
export const QUESTIONS_PER_HOUR = 10

const MAX_KM_IN_A_SHOE = 5000
const FIRST_RACE_YEAR = 1950

/** Shoe reviews may say how far the runner has gone in them; race reviews which year they ran it. */
export type ReviewDraft = { rating: Rating; title: string; body: string } & (
  | { subject: { kind: 'shoes'; id: Id<'shoes'> }; kmRun: number | null }
  | { subject: { kind: 'races'; id: Id<'races'> }; yearRun: number | null }
)

/** `review` names the member's own review to change; null writes a new one. */
export type WriteReview = { review: Id<'reviews'> | null; draft: ReviewDraft }

const textOf = (raw: unknown): string => (typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : firstOf(raw))

const idOf = <E extends string>(raw: unknown, message: string): FieldResult<Id<E>> => {
  const text = textOf(raw)
  return /^[1-9]\d{0,9}$/.test(text) ? ok(Number(text) as Id<E>) : err(message)
}

const ratingOf = (raw: unknown): FieldResult<Rating> => {
  const text = textOf(raw)
  return /^[1-5]$/.test(text) ? ok(Number(text) as Rating) : err('Choose a rating from 1 to 5.')
}

const wholeBetween = (raw: string, low: number, high: number, message: string): FieldResult<number> =>
  /^\d{1,5}$/.test(raw) && Number(raw) >= low && Number(raw) <= high ? ok(Number(raw)) : err(message)

/** Line breaks are kept, since a review is read as paragraphs; runs of spaces within a line are not. */
const plainText = (raw: unknown) =>
  firstOf(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')

export const parseWriteReview = (raw: RawInput, today: LocalDate): Result<WriteReview, FieldErrors> => {
  const kind = firstOf(raw.subjectKind)
  if (kind !== 'shoes' && kind !== 'races') return err({ subjectKind: 'Choose a shoe or a race to review.' })
  const reviewText = textOf(raw.review)
  const common = collect({
    review: reviewText === '' ? ok(null) : idOf<'reviews'>(reviewText, 'That review link is not valid.'),
    rating: ratingOf(raw.rating),
    title: textBetween(firstOf(raw.title).replace(/\s+/g, ' '), 1, REVIEW_TITLE_MAX, 'a title'),
    body: textBetween(plainText(raw.body), 1, REVIEW_BODY_MAX, 'your review'),
  })
  const year = Number(today.slice(0, 4))
  const extra =
    kind === 'shoes'
      ? collect({
          subjectId: idOf<'shoes'>(raw.subjectId, 'Choose a shoe to review.'),
          kmRun: optional(textOf(raw.kmRun), (text) => wholeBetween(text, 0, MAX_KM_IN_A_SHOE, `Enter whole kilometres from 0 to ${MAX_KM_IN_A_SHOE}.`)),
        })
      : collect({
          subjectId: idOf<'races'>(raw.subjectId, 'Choose a race to review.'),
          yearRun: optional(textOf(raw.yearRun), (text) => wholeBetween(text, FIRST_RACE_YEAR, year, `Enter a year from ${FIRST_RACE_YEAR} to ${year}.`)),
        })
  if (!common.ok || !extra.ok) return err({ ...(common.ok ? {} : common.error), ...(extra.ok ? {} : extra.error) })
  const { review, ...text } = common.value
  const draft: ReviewDraft =
    'kmRun' in extra.value
      ? { ...text, subject: { kind: 'shoes', id: extra.value.subjectId as Id<'shoes'> }, kmRun: extra.value.kmRun }
      : { ...text, subject: { kind: 'races', id: extra.value.subjectId as Id<'races'> }, yearRun: extra.value.yearRun }
  return ok({ review, draft })
}

export const parseReviewRef = (raw: RawInput): Result<{ review: Id<'reviews'> }, FieldErrors> => collect({ review: idOf<'reviews'>(raw.review, 'That review link is not valid.') })

export type QuestionDraft = { race: Id<'races'>; text: string }

export const parseAskQuestion = (raw: RawInput): Result<QuestionDraft, FieldErrors> =>
  collect({
    race: idOf<'races'>(raw.race, 'Choose a race to ask about.'),
    text: textBetween(plainText(raw.text), 1, QUESTION_MAX, 'your question'),
  })

export type AnswerDraft = { question: Id<'questions'>; answer: string }

export const parseAnswerQuestion = (raw: RawInput): Result<AnswerDraft, FieldErrors> =>
  collect({
    question: idOf<'questions'>(raw.question, 'That question link is not valid.'),
    answer: textBetween(plainText(raw.answer), 1, ANSWER_MAX, 'an answer'),
  })
