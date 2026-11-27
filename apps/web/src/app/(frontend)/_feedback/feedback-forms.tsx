'use client'

import { ANSWER_MAX, QUESTION_MAX, REVIEW_BODY_MAX, REVIEW_TITLE_MAX, type ReviewSubjectKind } from '@erc/domain'
import React, { useActionState } from 'react'

import { answerQuestionAction, askQuestionAction, writeReviewAction, type FeedbackFormState } from '@/members/actions'

function Outcome({ state }: { state: FeedbackFormState }) {
  if (state.saved) {
    return (
      <p className="member-saved" role="status">
        {state.saved}
      </p>
    )
  }
  return state.notice ? (
    <p className="member-alert" role="alert">
      {state.notice}
    </p>
  ) : null
}

function FieldError({ state, field, prefix }: { state: FeedbackFormState; field: string; prefix: string }) {
  const message = state.errors?.[field]
  return message ? (
    <span className="member-error" id={`${prefix}-${field}-error`}>
      {message}
    </span>
  ) : null
}

const invalid = (state: FeedbackFormState, field: string, prefix: string) =>
  state.errors?.[field] ? { 'aria-invalid': true, 'aria-describedby': `${prefix}-${field}-error` } : {}

const RATINGS = ['1', '2', '3', '4', '5'] as const

type ReviewFormProps = {
  subject: { kind: ReviewSubjectKind; id: number }
  /** The member's own live review, which this form changes; null writes a new one. */
  review: number | null
  initial: Readonly<Record<string, string>>
}

export function ReviewForm({ subject, review, initial }: ReviewFormProps) {
  const [state, action, pending] = useActionState(writeReviewAction, { values: initial })
  const { values } = state
  const prefix = 'review'
  return (
    <form className="member-form feedback-form" action={action}>
      <Outcome state={state} />
      <input type="hidden" name="subjectKind" value={subject.kind} />
      <input type="hidden" name="subjectId" value={subject.id} />
      <input type="hidden" name="review" value={review ?? ''} />
      <fieldset className="rating-picker" {...invalid(state, 'rating', prefix)}>
        <legend>Rating, where 5 is best</legend>
        <div className="rating-options">
          {RATINGS.map((rating) => (
            <label key={rating}>
              <input type="radio" name="rating" value={rating} required defaultChecked={values.rating === rating} />
              <span>{rating}</span>
            </label>
          ))}
        </div>
        <FieldError state={state} field="rating" prefix={prefix} />
      </fieldset>
      <label className="member-field">
        <span>Title</span>
        <input name="title" required maxLength={REVIEW_TITLE_MAX} defaultValue={values.title ?? ''} {...invalid(state, 'title', prefix)} />
        <FieldError state={state} field="title" prefix={prefix} />
      </label>
      <label className="member-field">
        <span>Your review</span>
        <textarea name="body" required rows={6} maxLength={REVIEW_BODY_MAX} defaultValue={values.body ?? ''} {...invalid(state, 'body', prefix)} />
        <FieldError state={state} field="body" prefix={prefix} />
        <span className="member-hint">Plain text, up to {REVIEW_BODY_MAX.toLocaleString('en-GB')} characters. Say what you found, not what you were told.</span>
      </label>
      {subject.kind === 'shoes' ? (
        <label className="member-field feedback-short">
          <span>Kilometres run in them (optional)</span>
          <input name="kmRun" inputMode="numeric" pattern="[0-9]*" defaultValue={values.kmRun ?? ''} {...invalid(state, 'kmRun', prefix)} />
          <FieldError state={state} field="kmRun" prefix={prefix} />
        </label>
      ) : (
        <label className="member-field feedback-short">
          <span>Year you ran it (optional)</span>
          <input name="yearRun" inputMode="numeric" pattern="[0-9]*" maxLength={4} defaultValue={values.yearRun ?? ''} {...invalid(state, 'yearRun', prefix)} />
          <FieldError state={state} field="yearRun" prefix={prefix} />
        </label>
      )}
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {review ? 'Save changes' : 'Send review'}
        </button>
      </div>
    </form>
  )
}

export function QuestionForm({ race }: { race: number }) {
  const [state, action, pending] = useActionState(askQuestionAction, { values: {} })
  const prefix = 'question'
  return (
    <form className="member-form feedback-form" action={action}>
      <Outcome state={state} />
      <input type="hidden" name="race" value={race} />
      <label className="member-field">
        <span>Your question</span>
        <textarea name="text" required rows={3} maxLength={QUESTION_MAX} defaultValue={state.values.text ?? ''} {...invalid(state, 'text', prefix)} />
        <FieldError state={state} field="text" prefix={prefix} />
        <span className="member-hint">A coach or a club volunteer answers. Questions show once they have been checked.</span>
      </label>
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          Ask
        </button>
      </div>
    </form>
  )
}

export function AnswerForm({ question, answer }: { question: number; answer: string | null }) {
  const [state, action, pending] = useActionState(answerQuestionAction, { values: { answer: answer ?? '' } })
  const prefix = `answer-${question}`
  return (
    <form className="member-form feedback-form" action={action}>
      <Outcome state={state} />
      <input type="hidden" name="question" value={question} />
      <label className="member-field">
        <span>{answer ? 'Your answer' : 'Answer'}</span>
        <textarea name="answer" required rows={4} maxLength={ANSWER_MAX} defaultValue={state.values.answer ?? ''} {...invalid(state, 'answer', prefix)} />
        <FieldError state={state} field="answer" prefix={prefix} />
      </label>
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {answer ? 'Save answer' : 'Answer'}
        </button>
      </div>
    </form>
  )
}
