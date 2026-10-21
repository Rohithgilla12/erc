'use client'

import React, { useActionState } from 'react'

import { HONEYPOT_FIELD, TOKEN_FIELD } from '@/content/form-fields'
import { submitSignup } from '@/content/newsletter-action'
import type { SignupFormState, SignupRefusal } from '@/content/newsletter'

import { PRIVACY_NOTICE } from '../../site-nav'

const REFUSALS: Record<SignupRefusal, string> = {
  too_fast: 'That was quicker than we expect from a person. Please send it again.',
  expired: 'This form was open for a long time, so we refreshed it. Please send it again.',
  rate_limited: 'We have had several signups from your connection in the last hour. Please try again later.',
  unavailable: 'We could not sign you up just now. Please try again in a few minutes.',
}

// With JavaScript off the browser posts to this page, and the fragment brings the reader back to this form.
const PERMALINK = '/newsletter#newsletter'

export function NewsletterForm({ initial }: { initial: SignupFormState }) {
  const [state, action, pending] = useActionState(submitSignup, initial, PERMALINK)

  if (state.kind === 'sent') {
    return (
      <div className="newsletter-sent" role="status">
        <p className="newsletter-sent-title">Check your inbox</p>
        <p>If this address is not already subscribed, we have emailed it a link to confirm. The link works for 48 hours.</p>
      </div>
    )
  }

  const message = state.kind === 'invalid' ? state.error : state.kind === 'refused' ? REFUSALS[state.reason] : null

  return (
    <form className="newsletter-form" action={action}>
      <input type="hidden" name={TOKEN_FIELD} value={state.token} />
      <label className="newsletter-label" htmlFor="newsletter-email">
        Email address
      </label>
      <div className="newsletter-row">
        <input
          id="newsletter-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          defaultValue={state.email}
          {...(message ? { 'aria-invalid': state.kind === 'invalid', 'aria-describedby': 'newsletter-message' } : {})}
        />
        <button className="button" type="submit" disabled={pending}>
          {pending ? 'Signing up…' : 'Sign up'}
        </button>
      </div>
      {message ? (
        <p className="newsletter-message" id="newsletter-message" role="alert">
          {message}
        </p>
      ) : null}
      <div className="newsletter-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <p className="newsletter-fineprint">
        We email you once to confirm. Unsubscribe any time. <a href={PRIVACY_NOTICE.href}>How we use your address</a>.
      </p>
    </form>
  )
}
