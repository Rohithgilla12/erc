'use client'

import { INTAKE_QUESTIONS, type FieldErrors, type IntakeQuestion } from '@erc/domain'
import React, { useActionState } from 'react'

import { saveIntakeAction, type IntakeFormState } from './actions'

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined

function Question({ question, value, error }: { question: IntakeQuestion; value: string; error: string | undefined }) {
  const id = `intake-${question.key}`
  const helpId = question.help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const notes = (
    <>
      {question.help ? (
        <span className="member-hint" id={helpId}>
          {question.help}
        </span>
      ) : null}
      {error ? (
        <span className="member-error" id={errorId}>
          {error}
        </span>
      ) : null}
    </>
  )
  const label = (
    <span>
      {question.label}
      {question.kind === 'number' && question.unit ? <span className="intake-unit"> ({question.unit})</span> : null}
      {question.required ? null : <span className="intake-unit"> (optional)</span>}
    </span>
  )

  if (question.kind === 'choice') {
    return (
      <fieldset className="intake-choice" aria-describedby={describedBy(helpId, errorId)}>
        <legend>{label}</legend>
        {question.options.map((option) => (
          <label className="member-check" key={option.value}>
            <input type="radio" name={question.key} value={option.value} required={question.required} defaultChecked={value === option.value} />
            <span>{option.label}</span>
          </label>
        ))}
        {notes}
      </fieldset>
    )
  }

  const common = {
    id,
    name: question.key,
    defaultValue: value,
    required: question.required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy(helpId, errorId),
  }
  return (
    <label className="member-field">
      {label}
      {question.kind === 'text' && question.multiline ? (
        <textarea {...common} rows={3} maxLength={question.maxLength} />
      ) : question.kind === 'text' ? (
        <input {...common} type="text" maxLength={question.maxLength} />
      ) : question.kind === 'time' ? (
        <input {...common} type="text" placeholder="mm:ss" autoComplete="off" className="intake-short" />
      ) : (
        <input {...common} type="text" inputMode={question.integer ? 'numeric' : 'decimal'} autoComplete="off" className="intake-short" />
      )}
      {notes}
    </label>
  )
}

function Group({ title, note, questions, state }: { title: string; note?: string; questions: readonly IntakeQuestion[]; state: IntakeFormState }) {
  return (
    <fieldset className="intake-group">
      <legend>{title}</legend>
      <div className="intake-questions">
        {note ? <p className="member-note">{note}</p> : null}
        {questions.map((question) => (
          <Question key={question.key} question={question} value={state.values[question.key] ?? ''} error={state.errors?.[question.key]} />
        ))}
      </div>
    </fieldset>
  )
}

const QUESTIONS: readonly IntakeQuestion[] = INTAKE_QUESTIONS
const RUNNING = QUESTIONS.filter((q) => !q.sensitive)
const HEALTH = QUESTIONS.filter((q) => q.sensitive)

export function IntakeForm({ initial, shareNote }: { initial: IntakeFormState; shareNote: string }) {
  const [state, action, pending] = useActionState(saveIntakeAction, initial)
  const errors: FieldErrors = state.errors ?? {}

  return (
    <form className="intake-form" action={action}>
      {state.saved ? (
        <p className="member-saved" role="status">
          Saved. {state.shareWithCoach ? 'Your coach can read these answers.' : 'Only you can read these answers.'}
        </p>
      ) : null}
      {state.notice ? (
        <p className="member-alert" role="alert">
          {state.notice}
        </p>
      ) : null}
      {Object.keys(errors).length > 0 ? (
        <p className="member-alert" role="alert">
          Some answers need a look. They are marked below.
        </p>
      ) : null}

      <Group title="Your running" questions={RUNNING} state={state} />
      <Group title="Your health" note="Answer what you are comfortable with. ERC never shows these to club staff." questions={HEALTH} state={state} />

      <fieldset className="intake-group">
        <legend>Sharing and consent</legend>
        <div className="intake-questions">
          <label className="member-check">
            <input type="checkbox" name="shareWithCoach" defaultChecked={state.shareWithCoach} aria-describedby="intake-share-help" />
            <span>Share my answers with my coach</span>
          </label>
          <span className="member-hint" id="intake-share-help">
            {shareNote}
          </span>
          <label className="member-check">
            <input
              type="checkbox"
              name="consent"
              required
              defaultChecked={state.consent}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? 'intake-consent-error' : undefined}
            />
            <span>ERC stores these answers to assess your starting point. They are not medical advice. Only you, and your coach if you choose, can see them.</span>
          </label>
          {errors.consent ? (
            <span className="member-error" id="intake-consent-error">
              {errors.consent}
            </span>
          ) : null}
        </div>
      </fieldset>

      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save intake'}
        </button>
      </div>
    </form>
  )
}
