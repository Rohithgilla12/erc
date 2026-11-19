import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import React from 'react'

import { issueFormToken } from '@/content/form-guard'
import { currentCaller, emailSignInOpen, googleSignInOpen } from '@/members/run'

import { PRIVACY_NOTICE } from '../site-nav'
import { SignInForm } from './sign-in-form'

import '../me/members.css'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } }

const GOOGLE_NOTICES: Record<string, string> = {
  age: 'Please confirm you are 18 or over to continue with Google.',
  cancelled: 'Google sign-in was cancelled.',
  expired: 'That sign-in took too long or came from another browser. Please try again.',
  unverified: 'Google has not verified the email address on that account, so we cannot use it to sign you in.',
  suspended: 'This account is suspended. Contact the club if you think that is a mistake.',
  failed: 'We could not finish signing you in with Google. Please try again.',
}

type Props = { searchParams: Promise<{ google?: string | string[] }> }

function GoogleSignIn() {
  return (
    <form className="member-form" method="post" action="/api/v1/google/start">
      <div className="member-field">
        <label className="member-check">
          <input name="over18" type="checkbox" value="on" required />
          <span>I am 18 or over.</span>
        </label>
        <p className="member-note">
          Signing in creates an account for your Google address if there is none. Our <a href={PRIVACY_NOTICE.href}>privacy notice</a> says what we keep.
        </p>
      </div>
      <div className="member-row">
        <button className="button" type="submit">
          Continue with Google
        </button>
      </div>
    </form>
  )
}

export default async function SignInPage({ searchParams }: Props) {
  const caller = await currentCaller()
  if (caller.kind === 'member') redirect('/me')
  const google = googleSignInOpen()
  const email = emailSignInOpen()
  if (!google && !email) {
    return (
      <div className="page member-page">
        <h1>Sign-in is not open yet</h1>
        <p className="member-lede">Member sign-in is not set up yet. Everything else on the site works without it.</p>
      </div>
    )
  }
  const reason = (await searchParams).google
  const notice = typeof reason === 'string' ? GOOGLE_NOTICES[reason] : undefined
  return (
    <div className="page member-page">
      <h1>Sign in</h1>
      {notice ? (
        <p className="member-alert" role="alert">
          {notice}
        </p>
      ) : null}
      {google ? <GoogleSignIn /> : null}
      {google && email ? <p className="member-lede">Or, without Google:</p> : null}
      {email ? (
        <>
          <p className="member-lede">Enter your email address and we will send you a six-digit code. There is no password.</p>
          <SignInForm initial={{ step: 'email', token: issueFormToken('sign-in'), email: '' }} />
        </>
      ) : null}
    </div>
  )
}
