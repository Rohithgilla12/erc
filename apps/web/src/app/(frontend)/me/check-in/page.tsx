import type { Metadata } from 'next'
import React from 'react'

import { requireMember, run } from '@/members/run'

import { CheckInForm } from './check-in-form'

import '../members.css'

export const metadata: Metadata = { title: 'Weekly Check-in', robots: { index: false, follow: false } }

export default async function CheckInPage() {
  const caller = await requireMember()
  const coaching = await run('myCoaching', caller, {})

  if (!coaching.ok) {
    return (
      <div className="page member-page">
        <header>
          <h1>Weekly Check-in</h1>
        </header>
        <p className="member-alert" role="alert">
          {coaching.error.fields ? Object.values(coaching.error.fields).join(' ') : coaching.error.message}
        </p>
        <p>
          <a href="/me">&larr; Back to my running</a>
        </p>
      </div>
    )
  }

  const { link, coach, currentCheckIn } = coaching.data
  const hasActiveCoach = Boolean(coach && link && link.state === 'active')

  if (!hasActiveCoach) {
    return (
      <div className="page member-page">
        <header>
          <p>
            <a href="/me">&larr; Back to my running</a>
          </p>
          <h1>Weekly Check-in</h1>
        </header>
        <div className="coaching-card coaching-card--empty">
          <div>
            <h2 className="coaching-card-title">Active coach required</h2>
            <p className="coaching-card-desc">
              Weekly check-ins are shared directly with your coach. Connect with a club coach to start checking in.
            </p>
          </div>
          <a href="/me/coaching" className="button button-secondary">
            Find a coach
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me">&larr; Back to my running</a>
        </p>
        <h1>Weekly Check-in</h1>
        <p className="member-lede">
          Coached by <strong>{coach?.name}</strong>. Share how your training felt and highlight any issues.
        </p>
      </header>

      <CheckInForm
        initial={{
          values: {
            feeling: currentCheckIn?.feeling ?? '',
            niggles: currentCheckIn?.niggles ?? '',
            note: currentCheckIn?.note ?? '',
          },
        }}
      />
    </div>
  )
}
