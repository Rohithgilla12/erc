import type { Metadata } from 'next'
import React from 'react'

import { endCoachingAction, requestCoachAction } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import '../members.css'

export const metadata: Metadata = { title: 'Coaching', robots: { index: false, follow: false } }

export default async function CoachingPage() {
  const caller = await requireMember()
  const coaching = await run('myCoaching', caller, {})

  if (!coaching.ok) {
    return (
      <div className="page member-page">
        <header>
          <h1>Coaching</h1>
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

  const { link, coach, availableCoaches = [] } = coaching.data
  const hasCoach = coach && link && (link.state === 'active' || link.state === 'requested')
  const isActive = link?.state === 'active'
  const isPending = link?.state === 'requested'

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me">&larr; Back to my running</a>
        </p>
        <h1>Coaching</h1>
      </header>

      {hasCoach ? (
        <section aria-labelledby="current-coach-heading" className="coaching-section">
          <h2 id="current-coach-heading">Your coach</h2>
          <div className="coaching-card">
            <div className="coaching-coach-row">
              {coach.photoUrl ? (
                <img src={coach.photoUrl} alt="" className="coaching-coach-photo" />
              ) : (
                <div className="coaching-coach-avatar" aria-hidden="true">
                  {coach.name.slice(0, 1)}
                </div>
              )}
              <div className="coaching-coach-info">
                <div className="coaching-coach-name-row">
                  <h3 className="coaching-coach-name">{coach.name}</h3>
                  <span
                    className={`coaching-status-badge ${
                      isActive ? 'coaching-status-badge--active' : 'coaching-status-badge--pending'
                    }`}
                  >
                    {isActive ? 'Active Coach' : 'Request pending - waiting for coach to accept'}
                  </span>
                </div>
                {coach.credentials ? <p className="coaching-coach-credentials">{coach.credentials}</p> : null}
              </div>
            </div>

            {isPending ? (
              <p className="coaching-pending-note">
                Request pending - waiting for coach to accept.
              </p>
            ) : null}

            {isActive ? (
              <div>
                <form action={endCoachingAction}>
                  <button type="submit" className="button button-danger">
                    End coaching relationship
                  </button>
                </form>
              </div>
            ) : isPending ? (
              <div>
                <form action={endCoachingAction}>
                  <button type="submit" className="button button-secondary">
                    Cancel request
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </section>
      ) : (
        <section aria-labelledby="available-coaches-heading" className="coaching-section">
          <h2 id="available-coaches-heading">Available coaches</h2>
          <p className="member-note">
            Request coaching from an ERC club coach to get weekly training reviews, check-ins, and personalized feedback.
          </p>

          {availableCoaches.length === 0 ? (
            <p className="member-note">No coaches are currently available for new requests.</p>
          ) : (
            <ul className="coaches-list">
              {availableCoaches.map((c) => (
                <li key={c.id} className="coaches-list-item">
                  <div className="coaching-coach-row">
                    {c.photoUrl ? (
                      <img src={c.photoUrl} alt="" className="coaching-coach-photo" />
                    ) : (
                      <div className="coaching-coach-avatar" aria-hidden="true">
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="coaching-coach-info">
                      <h3 className="coaching-coach-name">{c.name}</h3>
                      {c.credentials ? <p className="coaching-coach-credentials">{c.credentials}</p> : null}
                    </div>
                  </div>
                  <form action={requestCoachAction}>
                    <input type="hidden" name="coachId" value={c.id} />
                    <button type="submit" className="button">
                      Request Coach
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
