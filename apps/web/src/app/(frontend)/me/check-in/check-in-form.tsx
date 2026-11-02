'use client'

import React, { useActionState } from 'react'

import { submitCheckInAction, type CheckInFormState } from '@/members/actions'

const FEELINGS = [
  { value: 'great', label: 'Great' },
  { value: 'good', label: 'Good' },
  { value: 'tired', label: 'Tired' },
  { value: 'struggling', label: 'Struggling' },
  { value: 'injured', label: 'Injured' },
] as const

type Field = 'feeling' | 'niggles' | 'note'

function FieldError({ errors, field }: { errors: CheckInFormState['errors']; field: Field }) {
  const message = errors?.[field]
  return message ? (
    <span className="member-error" id={`checkin-${field}-error`}>
      {message}
    </span>
  ) : null
}

export function CheckInForm({ initial }: { initial: CheckInFormState }) {
  const [state, action, pending] = useActionState(submitCheckInAction, initial)
  const { values, errors } = state

  return (
    <form className="member-form" action={action}>
      {state.saved ? (
        <p className="member-saved" role="status">
          Check-in submitted successfully.
        </p>
      ) : null}
      {state.notice ? (
        <p className="member-alert" role="alert">
          {state.notice}
        </p>
      ) : null}

      <fieldset className="check-in-feelings-fieldset">
        <legend>How did your training feel this week?</legend>
        <div className="check-in-feelings-grid">
          {FEELINGS.map((item) => (
            <label key={item.value} className="check-in-feeling-label">
              <input
                type="radio"
                name="feeling"
                value={item.value}
                required
                defaultChecked={values.feeling === item.value}
                aria-describedby={errors?.feeling ? 'checkin-feeling-error' : undefined}
              />
              <span className="check-in-feeling-name">{item.label}</span>
            </label>
          ))}
        </div>
        <FieldError errors={errors} field="feeling" />
      </fieldset>

      <label className="member-field">
        <span>Any niggles, aches, or tightness?</span>
        <input
          name="niggles"
          type="text"
          maxLength={280}
          placeholder="e.g. Left hamstring was tight after Tuesday's intervals"
          defaultValue={values.niggles ?? ''}
          aria-invalid={errors?.niggles ? true : undefined}
          aria-describedby={errors?.niggles ? 'checkin-niggles-error' : undefined}
        />
        <FieldError errors={errors} field="niggles" />
        <span className="member-hint">Max 280 characters.</span>
      </label>

      <label className="member-field">
        <span>Weekly training notes or questions for your coach</span>
        <textarea
          name="note"
          rows={4}
          maxLength={1000}
          placeholder="e.g. Hit target paces on Sunday's long run. Feeling ready to progress mileage."
          defaultValue={values.note ?? ''}
          aria-invalid={errors?.note ? true : undefined}
          aria-describedby={errors?.note ? 'checkin-note-error' : undefined}
        />
        <FieldError errors={errors} field="note" />
        <span className="member-hint">Max 1000 characters.</span>
      </label>

      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit Check-in'}
        </button>
        <a href="/me" className="member-link-cancel">
          Cancel
        </a>
      </div>
    </form>
  )
}
