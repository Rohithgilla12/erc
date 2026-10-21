'use client'

import React, { useActionState } from 'react'

import { logRun, type RunFormState } from '@/members/actions'

// With JavaScript off the browser posts to this page, and the fragment brings the member back to the form.
const PERMALINK = '/me#log-run'

type Field = keyof RunFormState['values']

const invalidProps = (errors: RunFormState['errors'], field: Field) =>
  errors?.[field] ? { 'aria-invalid': true as const, 'aria-describedby': `run-${field}-error` } : {}

function FieldError({ errors, field }: { errors: RunFormState['errors']; field: Field }) {
  const message = errors?.[field]
  return message ? (
    <span className="member-error" id={`run-${field}-error`}>
      {message}
    </span>
  ) : null
}

const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`

export function RunForm({ initial, today }: { initial: RunFormState; today: string }) {
  const [state, action, pending] = useActionState(logRun, initial, PERMALINK)
  const { values, errors } = state

  return (
    <form className="member-form" action={action}>
      <input type="hidden" name="ref" value={state.ref} />
      {state.saved ? (
        <p className="member-saved" role="status">
          Saved: {km(state.saved.distance)} on {state.saved.on}.
        </p>
      ) : null}
      {state.notice ? (
        <p className="member-alert" role="alert">
          {state.notice}
        </p>
      ) : null}
      <div className="member-fields">
        <label className="member-field">
          <span>Date</span>
          <input name="date" type="date" max={today} required defaultValue={values.date} {...invalidProps(errors, 'date')} />
          <FieldError errors={errors} field="date" />
        </label>
        <label className="member-field">
          <span>Distance (km)</span>
          <input name="distanceKm" type="text" inputMode="decimal" placeholder="6.2" required defaultValue={values.distanceKm} {...invalidProps(errors, 'distanceKm')} />
          <FieldError errors={errors} field="distanceKm" />
        </label>
        <label className="member-field">
          <span>Time</span>
          <input name="duration" type="text" inputMode="numeric" placeholder="38:10" required defaultValue={values.duration} {...invalidProps(errors, 'duration')} />
          <FieldError errors={errors} field="duration" />
        </label>
      </div>
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Log run'}
        </button>
        <span className="member-hint">Time as minutes:seconds, or hours:minutes:seconds.</span>
      </div>
    </form>
  )
}
