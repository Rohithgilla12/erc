import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import React from 'react'

import { currentCaller, signInOpen } from '@/members/run'

import { SignInForm } from './sign-in-form'

import '../me/members.css'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } }

export default async function SignInPage() {
  const caller = await currentCaller()
  if (caller.kind === 'member') redirect('/me')
  if (!signInOpen()) {
    return (
      <div className="page member-page">
        <h1>Sign-in is not open yet</h1>
        <p className="member-lede">Member sign-in needs the club to be able to send email, which is not set up yet. Everything else on the site works without it.</p>
      </div>
    )
  }
  return (
    <div className="page member-page">
      <h1>Sign in</h1>
      <p className="member-lede">Enter your email address and we will send you a six-digit code. There is no password.</p>
      <SignInForm initial={{ step: 'email', email: '' }} />
    </div>
  )
}
