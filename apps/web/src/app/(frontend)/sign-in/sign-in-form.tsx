'use client'

import React, { useActionState } from 'react'

import { HONEYPOT_FIELD } from '@/content/form-fields'
import { signIn, type SignInFormState } from '@/members/actions'

import { PRIVACY_NOTICE } from '../site-nav'

// With JavaScript off the browser posts to this page, which renders the returned step.
const PERMALINK = '/sign-in'

const invalidProps = (errors: SignInFormState['errors'], field: string) =>
  errors?.[field] ? { 'aria-invalid': true as const, 'aria-describedby': `sign-in-${field}-error` } : {}

function FieldError({ errors, field }: { errors: SignInFormState['errors']; field: string }) {
  const message = errors?.[field]
  return message ? (
    <span className="member-error" id={`sign-in-${field}-error`}>
      {message}
    </span>
  ) : null
}

export function SignInForm({ initial }: { initial: SignInFormState }) {
  const [state, action, pending] = useActionState(signIn, initial, PERMALINK)

  if (state.step === 'code') {
    return (
      <>
        <p>
          We have emailed a six-digit code to <strong>{state.email}</strong>. It works for 10 minutes.
        </p>
        {state.notice ? (
          <p className="member-alert" role="alert">
            {state.notice}
          </p>
        ) : null}
        <form className="member-form" action={action}>
          <input type="hidden" name="step" value="code" />
          <input type="hidden" name="email" value={state.email} />
          <label className="member-field">
            <span>Code from the email</span>
            <input
              className="member-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              required
              maxLength={7}
              autoFocus
              {...invalidProps(state.errors, 'code')}
            />
            <FieldError errors={state.errors} field="code" />
          </label>
          <div className="member-row">
            <button className="button" type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <form className="member-row" action={action}>
          <input type="hidden" name="step" value="email" />
          <input type="hidden" name="email" value={state.email} />
          <input type="hidden" name="over18" value="on" />
          <button className="button button-secondary" type="submit" disabled={pending}>
            Send a new code
          </button>
          <a href="/sign-in">Use a different address</a>
        </form>
      </>
    )
  }

  return (
    <form className="member-form" action={action}>
      <input type="hidden" name="step" value="email" />
      {state.notice ? (
        <p className="member-alert" role="alert">
          {state.notice}
        </p>
      ) : null}
      <label className="member-field">
        <span>Email address</span>
        <input name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} defaultValue={state.email} {...invalidProps(state.errors, 'email')} />
        <FieldError errors={state.errors} field="email" />
      </label>
      <div className="member-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="member-field">
        <label className="member-check">
          <input name="over18" type="checkbox" value="on" required {...invalidProps(state.errors, 'over18')} />
          <span>I am 18 or over.</span>
        </label>
        <FieldError errors={state.errors} field="over18" />
        <p className="member-note">
          Signing in creates an account for this address if there is none. Our <a href={PRIVACY_NOTICE.href}>privacy notice</a> says what we keep.
        </p>
      </div>
      <div className="member-row">
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Email me a code'}
        </button>
      </div>
    </form>
  )
}
