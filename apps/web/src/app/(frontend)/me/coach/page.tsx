import type { Metadata } from 'next'
import React from 'react'

import type { CoachRosterItem } from '@erc/contract'
import { formatDuration, formatKm, type Metres, type Seconds, type WatchFlag } from '@erc/domain'

import { decideCoachingAction } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import '../members.css'

export const metadata: Metadata = {
  title: 'Coach Roster',
  robots: { index: false, follow: false },
}

const clubDay = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})
const formatInstant = (instant: string) => clubDay.format(new Date(instant))

const FLAG_LABELS: Record<WatchFlag, string> = {
  VOLUME_SPIKE: 'Volume spike',
  NO_REST_DAY: 'No rest day',
  LONG_RUN_HEAVY: 'Heavy long run',
  ELEVATED_FATIGUE: 'Elevated fatigue',
  NIGGLE_REPORTED: 'Niggle reported',
  MISSED_LOGS: 'Missed logs',
}

const FEELING_LABELS: Record<string, string> = {
  great: 'Great',
  good: 'Good',
  tired: 'Tired',
  struggling: 'Struggling',
  injured: 'Injured',
}

function AthleteCard({ athlete }: { athlete: CoachRosterItem }) {
  const detailHref = `/me/coach/${athlete.athleteSlug}`
  const flags = athlete.flags ?? []

  return (
    <li className="roster-athlete-card">
      <div className="roster-athlete-main">
        <div className="roster-athlete-profile">
          {athlete.athletePhotoUrl ? (
            <img src={athlete.athletePhotoUrl} alt="" className="coaching-coach-photo" />
          ) : (
            <div className="coaching-coach-avatar" aria-hidden="true">
              {athlete.athleteName.slice(0, 1)}
            </div>
          )}
          <div className="roster-athlete-info">
            <h4 className="roster-athlete-name">
              <a href={detailHref}>{athlete.athleteName}</a>
            </h4>
            <div className="roster-athlete-stats">
              <span>{formatKm(athlete.totalMetres as Metres)}</span>
              <span className="roster-stat-sep" aria-hidden="true">&bull;</span>
              <span>{formatDuration(athlete.totalSeconds as Seconds)}</span>
              <span className="roster-stat-sep" aria-hidden="true">&bull;</span>
              <span>{athlete.runCount} {athlete.runCount === 1 ? 'run' : 'runs'}</span>
            </div>
          </div>
        </div>

        <div className="roster-athlete-badges">
          {athlete.checkIn ? (
            <span className={`roster-pill roster-pill--feeling-${athlete.checkIn.feeling}`}>
              {FEELING_LABELS[athlete.checkIn.feeling] ?? athlete.checkIn.feeling}
            </span>
          ) : (
            <span className="roster-pill roster-pill--muted">No check-in yet</span>
          )}

          {athlete.checkIn?.niggles ? (
            <span className="roster-pill roster-pill--niggle" title={athlete.checkIn.niggles}>
              Niggle reported
            </span>
          ) : null}

          {flags.map((flag) => (
            <span key={flag} className="roster-pill roster-pill--flag">
              {FLAG_LABELS[flag] ?? flag}
            </span>
          ))}

          <span
            className={`roster-pill ${
              athlete.hasReview ? 'roster-pill--reviewed' : 'roster-pill--needs-review'
            }`}
          >
            {athlete.hasReview ? 'Reviewed' : 'Needs review'}
          </span>
        </div>
      </div>

      <div className="roster-athlete-actions">
        <a href={detailHref} className="button button-secondary">
          Review week &rarr;
        </a>
      </div>
    </li>
  )
}

export default async function CoachRosterPage() {
  const caller = await requireMember()
  if (!caller.session.coachId) {
    return (
      <div className="page member-page">
        <h1>Coach Roster</h1>
        <p className="member-alert" role="alert">
          You must be a designated club coach to access this page.
        </p>
        <p>
          <a href="/me">&larr; Return to my running</a>
        </p>
      </div>
    )
  }

  const res = await run('roster', caller, {})
  if (!res.ok) {
    return (
      <div className="page member-page">
        <header>
          <p>
            <a href="/me">&larr; Return to my running</a>
          </p>
          <h1>Coach Roster</h1>
        </header>
        <p className="member-alert" role="alert">
          {res.error.fields ? Object.values(res.error.fields).join(' ') : res.error.message}
        </p>
        <p>
          <a href="/me">&larr; Return to my running</a>
        </p>
      </div>
    )
  }

  const { coach, pendingRequests = [], athletes = [] } = res.data

  const flaggedAthletes = athletes.filter((a) => (a.flags?.length ?? 0) > 0)
  const pendingReviews = athletes.filter(
    (a) => (a.flags?.length ?? 0) === 0 && a.checkIn !== null && !a.hasReview,
  )
  const onTrack = athletes.filter(
    (a) => (a.flags?.length ?? 0) === 0 && !(a.checkIn !== null && !a.hasReview),
  )

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me">&larr; Return to my running</a>
        </p>
        <h1>Coach Roster</h1>
        {coach?.name ? (
          <p className="member-lede">
            Club Coach: <strong>{coach.name}</strong>
          </p>
        ) : null}
      </header>

      {pendingRequests.length > 0 ? (
        <section aria-labelledby="pending-requests-heading" className="coaching-section">
          <h2 id="pending-requests-heading">Pending Requests ({pendingRequests.length})</h2>
          <ul className="coaches-list">
            {pendingRequests.map((req) => (
              <li key={req.linkId} className="coaches-list-item">
                <div className="coaching-coach-row">
                  {req.athletePhotoUrl ? (
                    <img src={req.athletePhotoUrl} alt="" className="coaching-coach-photo" />
                  ) : (
                    <div className="coaching-coach-avatar" aria-hidden="true">
                      {req.athleteName.slice(0, 1)}
                    </div>
                  )}
                  <div className="coaching-coach-info">
                    <h3 className="coaching-coach-name">{req.athleteName}</h3>
                    {req.requestedAt ? (
                      <p className="coaching-coach-credentials">
                        Requested on{' '}
                        <time dateTime={String(req.requestedAt)}>
                          {formatInstant(String(req.requestedAt))}
                        </time>
                      </p>
                    ) : null}
                  </div>
                </div>
                <form action={decideCoachingAction} className="coach-decision-form">
                  <input type="hidden" name="linkId" value={req.linkId} />
                  <button type="submit" name="decision" value="accept" className="button">
                    Accept
                  </button>
                  <button type="submit" name="decision" value="reject" className="button button-secondary">
                    Decline
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="active-roster-heading" className="coaching-section">
        <h2 id="active-roster-heading">Active Roster ({athletes.length})</h2>

        {athletes.length === 0 ? (
          <p className="member-note">
            No active athletes on your roster yet. When athletes request coaching and you accept,
            they will appear here with weekly training summaries.
          </p>
        ) : (
          <div className="roster-groups">
            {flaggedAthletes.length > 0 ? (
              <div className="roster-group">
                <div className="roster-group-header">
                  <h3 className="roster-group-title roster-group-title--flagged">
                    Flagged Athletes ({flaggedAthletes.length})
                  </h3>
                  <p className="roster-group-desc">
                    Athletes with fatigue, niggles, or volume spikes needing coach attention.
                  </p>
                </div>
                <ul className="roster-list">
                  {flaggedAthletes.map((a) => (
                    <AthleteCard key={a.linkId} athlete={a} />
                  ))}
                </ul>
              </div>
            ) : null}

            {pendingReviews.length > 0 ? (
              <div className="roster-group">
                <div className="roster-group-header">
                  <h3 className="roster-group-title roster-group-title--pending">
                    Pending Reviews ({pendingReviews.length})
                  </h3>
                  <p className="roster-group-desc">
                    Athletes who submitted weekly check-ins awaiting your review and recommendations.
                  </p>
                </div>
                <ul className="roster-list">
                  {pendingReviews.map((a) => (
                    <AthleteCard key={a.linkId} athlete={a} />
                  ))}
                </ul>
              </div>
            ) : null}

            {onTrack.length > 0 ? (
              <div className="roster-group">
                <div className="roster-group-header">
                  <h3 className="roster-group-title roster-group-title--ontrack">
                    On Track ({onTrack.length})
                  </h3>
                  <p className="roster-group-desc">Athletes progressing smoothly with training.</p>
                </div>
                <ul className="roster-list">
                  {onTrack.map((a) => (
                    <AthleteCard key={a.linkId} athlete={a} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
