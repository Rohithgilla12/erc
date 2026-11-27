import type { MyCoachingView } from '@erc/contract'
import { CLUB_TIME_ZONE, INTAKE_QUESTIONS, intakeFieldValue, type IntakeKey } from '@erc/domain'
import type { Metadata } from 'next'
import React from 'react'

import { requireMember, run } from '@/members/run'

import { clearIntakeAction } from './actions'
import { IntakeForm } from './intake-form'

import '../members.css'
import './intake.css'

export const metadata: Metadata = { title: 'Intake', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ cleared?: string }> }

const clubDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: CLUB_TIME_ZONE })

const shareNoteOf = (coaching: MyCoachingView | null): string => {
  const coach = coaching?.coach?.name
  if (coaching?.link?.state === 'active' && coach) return `${coach} reads them while they coach you and this is ticked. Untick it to hide them straight away.`
  if (coaching?.link?.state === 'requested' && coach) return `${coach} can read them once they accept your request, while this is ticked.`
  return 'You have no coach yet. Once a coach accepts you, they can read your answers while this is ticked.'
}

export default async function IntakePage({ searchParams }: Props) {
  const caller = await requireMember()
  const { cleared } = await searchParams
  const [intake, coaching] = await Promise.all([run('myIntake', caller, {}), run('myCoaching', caller, {})])

  if (!intake.ok) {
    return (
      <div className="page member-page">
        <h1>Intake</h1>
        <p className="member-alert" role="alert">
          {intake.error.message}
        </p>
      </div>
    )
  }

  const saved = intake.data
  const values = Object.fromEntries(INTAKE_QUESTIONS.map((q) => [q.key, saved ? intakeFieldValue(q.key, saved.answers[q.key as IntakeKey]) : '']))

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me">&larr; Back to my running</a>
        </p>
        <h1>Intake</h1>
        <p className="member-lede">
          A starting point for you and your coach: your running, how you recover, and your health. It takes about five minutes, and you can change it
          any time.
        </p>
      </header>

      {cleared && !saved ? (
        <p className="member-saved" role="status">
          Your intake is deleted. Nothing of it is kept.
        </p>
      ) : null}
      {saved ? (
        <p className="member-note">
          Last saved {clubDay.format(new Date(saved.updatedAt))}. {saved.shareWithCoach ? 'Shared with your coach.' : 'Not shared with a coach.'}
        </p>
      ) : null}

      <IntakeForm
        key={cleared ?? 'form'}
        initial={{ values, shareWithCoach: saved?.shareWithCoach ?? false, consent: false }}
        shareNote={shareNoteOf(coaching.ok ? coaching.data : null)}
      />

      {saved ? (
        <section className="intake-delete" aria-labelledby="intake-delete">
          <h2 id="intake-delete">Delete your intake</h2>
          <p className="member-note">This removes every answer at once, for you and your coach. You can fill it in again later.</p>
          <form action={clearIntakeAction}>
            <button className="button button-danger" type="submit">
              Delete my intake
            </button>
          </form>
        </section>
      ) : null}
    </div>
  )
}
