'use client'

import { ENQUIRY_TOPICS, type EnquiryErrors, type EnquiryField } from '@erc/domain'
import React, { useActionState, type ReactNode } from 'react'

import { submitEnquiry } from '@/content/enquiry-action'
import { HONEYPOT_FIELD, TOKEN_FIELD } from '@/content/enquiry-fields'
import type { EnquiryFormState, EnquiryRefusal } from '@/content/enquiries'

import { CLUB } from '../site-nav'

const REFUSALS: Record<EnquiryRefusal, ReactNode> = {
  too_fast: 'That was quicker than we expect from a person. Check your message and send it again.',
  expired: 'This form was open for a long time, so we refreshed it. Your message is still here; send it again.',
  rate_limited: (
    <>
      We have had several messages from your connection in the last hour. Please try again later, or message us on{' '}
      <a href={CLUB.instagramUrl} rel="me noopener">
        Instagram
      </a>
      .
    </>
  ),
  unavailable: 'We could not save your message just now. Please try again in a few minutes.',
}

const LABELS: Record<EnquiryField, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  topic: 'Topic',
  message: 'Message',
  consent: 'Permission to reply',
}

const errorId = (field: EnquiryField) => `enquiry-${field}-error`

function FieldError({ errors, field }: { errors: EnquiryErrors; field: EnquiryField }) {
  const message = errors[field]
  return message ? (
    <span className="enquiry-error" id={errorId(field)}>
      {message}
    </span>
  ) : null
}

const invalidProps = (errors: EnquiryErrors, field: EnquiryField) =>
  errors[field] ? { 'aria-invalid': true as const, 'aria-describedby': errorId(field) } : {}

// With JavaScript off the browser posts to this URL, and the fragment brings the reader back to the form.
const PERMALINK = '/contact#enquiry'

export function EnquiryForm({ initial }: { initial: EnquiryFormState }) {
  const [state, action, pending] = useActionState(submitEnquiry, initial, PERMALINK)

  if (state.kind === 'sent') {
    return (
      <div className="enquiry-sent" role="status">
        <h3>Thank you, your message is with us</h3>
        <p>We will reply by email.</p>
        <p>
          <a href="/contact">Send another message</a>
        </p>
      </div>
    )
  }

  const errors: EnquiryErrors = state.kind === 'invalid' ? state.errors : {}
  const invalid = Object.keys(errors) as EnquiryField[]
  const { values } = state

  return (
    <form className="enquiry-form" action={action}>
      {state.kind === 'refused' ? (
        <p className="enquiry-alert" role="alert">
          {REFUSALS[state.reason]}
        </p>
      ) : null}
      {invalid.length > 0 ? (
        <div className="enquiry-alert" role="alert">
          <p>Please check {invalid.length === 1 ? 'this field' : 'these fields'}:</p>
          <ul>
            {invalid.map((field) => (
              <li key={field}>
                <a href={`#enquiry-${field}`}>{LABELS[field]}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <input type="hidden" name={TOKEN_FIELD} value={state.token} />

      <label className="enquiry-field">
        <span>Name</span>
        <input id="enquiry-name" name="name" type="text" autoComplete="name" required maxLength={120} defaultValue={values.name} {...invalidProps(errors, 'name')} />
        <FieldError errors={errors} field="name" />
      </label>

      <label className="enquiry-field">
        <span>Email</span>
        <input id="enquiry-email" name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={values.email} {...invalidProps(errors, 'email')} />
        <FieldError errors={errors} field="email" />
      </label>

      <label className="enquiry-field">
        <span>
          Phone <span className="enquiry-optional">(optional)</span>
        </span>
        <input id="enquiry-phone" name="phone" type="tel" autoComplete="tel" maxLength={32} defaultValue={values.phone} {...invalidProps(errors, 'phone')} />
        <FieldError errors={errors} field="phone" />
      </label>

      <label className="enquiry-field">
        <span>What is it about?</span>
        <select id="enquiry-topic" name="topic" required defaultValue={values.topic} {...invalidProps(errors, 'topic')}>
          <option value="" disabled>
            Choose one
          </option>
          {ENQUIRY_TOPICS.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <FieldError errors={errors} field="topic" />
      </label>

      <label className="enquiry-field">
        <span>Message</span>
        <textarea id="enquiry-message" name="message" rows={6} required maxLength={4000} defaultValue={values.message} {...invalidProps(errors, 'message')} />
        <FieldError errors={errors} field="message" />
      </label>

      <div className="enquiry-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input name={HONEYPOT_FIELD} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="enquiry-field">
        <label className="enquiry-check">
          <input id="enquiry-consent" name="consent" type="checkbox" required defaultChecked={values.consent} {...invalidProps(errors, 'consent')} />
          <span>You may contact me by email or phone about this message.</span>
        </label>
        <FieldError errors={errors} field="consent" />
      </div>

      <button className="button enquiry-submit" type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}
