import type { Metadata } from 'next'
import React from 'react'

import {
  addDays,
  formatDuration,
  formatKm,
  type LocalDate,
  type Metres,
  type Seconds,
  type WatchFlag,
} from '@erc/domain'

import { saveWeekReviewAction } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import '../../members.css'

export const metadata: Metadata = {
  title: 'Athlete Week Review',
  robots: { index: false, follow: false },
}

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ weekStart?: string; saved?: string }>
}

const dayFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const formatDay = (date: LocalDate | string) => dayFormat.format(new Date(`${date}T00:00:00Z`))

const weekFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const formatWeek = (date: LocalDate | string) => weekFormat.format(new Date(`${date}T00:00:00Z`))

const paceOf = (distance: Metres, moving: Seconds) => {
  if (distance <= 0) return '0:00 /km'
  return `${formatDuration(Math.round(moving / (distance / 1000)) as Seconds)} /km`
}

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

export default async function AthleteWeekReviewPage({ params, searchParams }: Props) {
  const caller = await requireMember()
  if (!caller.session.coachId) {
    return (
      <div className="page member-page">
        <h1>Athlete Week Review</h1>
        <p className="member-alert" role="alert">
          You must be a designated club coach to access this page.
        </p>
        <p>
          <a href="/me">&larr; Return to my running</a>
        </p>
      </div>
    )
  }

  const { slug } = await params
  const { weekStart, saved } = await searchParams
  const res = await run('athleteWeek', caller, {
    athleteSlug: slug,
    ...(weekStart ? { weekStart } : {}),
  })

  if (!res.ok) {
    return (
      <div className="page member-page">
        <header>
          <p>
            <a href="/me/coach">&larr; Back to Coach Roster</a>
          </p>
          <h1>Athlete Week Review</h1>
        </header>
        <p className="member-alert" role="alert">
          {res.error.fields ? Object.values(res.error.fields).join(' ') : res.error.message}
        </p>
        <p>
          <a href="/me/coach">&larr; Return to Coach Roster</a>
        </p>
      </div>
    )
  }

  const { athlete, weekStart: currentWeekStart, runs, checkIn, summary, review } = res.data
  const currentWeekDate = currentWeekStart as LocalDate
  const prevWeekDate = addDays(currentWeekDate, -7)
  const nextWeekDate = addDays(currentWeekDate, 7)

  const watchPrefill =
    review && review.watch.length > 0
      ? review.watch.join('\n')
      : summary.suggestedWatch.join('\n')

  const recoPrefill =
    review && review.recommendations.length > 0
      ? review.recommendations.join('\n')
      : summary.suggestedRecos.join('\n')

  const notePrefill = review?.note ?? ''

  return (
    <div className="page member-page">
      <header>
        <p>
          <a href="/me/coach">&larr; Back to Coach Roster</a>
        </p>
        <div className="coaching-coach-row">
          {athlete.photoUrl ? (
            <img src={athlete.photoUrl} alt="" className="coaching-coach-photo" />
          ) : (
            <div className="coaching-coach-avatar" aria-hidden="true">
              {athlete.name.slice(0, 1)}
            </div>
          )}
          <div>
            <h1>{athlete.name}</h1>
            <p className="member-lede">
              Weekly Training Review &bull;{' '}
              <a href={`/athletes/${athlete.slug}`}>View Athlete Profile &rarr;</a>
            </p>
          </div>
        </div>

        <nav aria-label="Week navigation" className="coach-week-nav">
          <a
            href={`/me/coach/${slug}?weekStart=${prevWeekDate}`}
            className="button button-secondary"
          >
            &larr; Previous Week
          </a>
          <span className="coach-current-week">
            Week of <strong>{formatWeek(currentWeekDate)}</strong>
          </span>
          <a
            href={`/me/coach/${slug}?weekStart=${nextWeekDate}`}
            className="button button-secondary"
          >
            Next Week &rarr;
          </a>
        </nav>
      </header>

      {saved === 'true' ? (
        <p className="member-saved" role="status">
          Weekly review published and saved successfully.
        </p>
      ) : null}

      {/* Weekly Stats Card */}
      <section aria-labelledby="weekly-stats-heading" className="coaching-section">
        <h2 id="weekly-stats-heading">Weekly Summary</h2>
        <div className="coaching-card">
          <div className="member-stats">
            <div className="member-stat">
              <span className="member-stat-title">Total Distance</span>
              <p className="member-stat-value">{formatKm(summary.totalMetres as Metres)}</p>
            </div>
            <div className="member-stat">
              <span className="member-stat-title">Moving Time</span>
              <p className="member-stat-value">{formatDuration(summary.totalSeconds as Seconds)}</p>
            </div>
            <div className="member-stat">
              <span className="member-stat-title">Total Runs</span>
              <p className="member-stat-value">{summary.runCount}</p>
            </div>
            <div className="member-stat">
              <span className="member-stat-title">Volume vs Last Week</span>
              <p className="member-stat-value">
                {summary.volumeChangePct !== null
                  ? `${summary.volumeChangePct >= 0 ? '+' : ''}${summary.volumeChangePct}%`
                  : 'N/A'}
              </p>
            </div>
          </div>

          {summary.flags.length > 0 ? (
            <div className="coaching-flags-row">
              <span className="coaching-review-label">Triggered flags:</span>
              <ul className="coaching-pill-list">
                {summary.flags.map((flag) => (
                  <li key={flag} className="roster-pill roster-pill--flag">
                    {FLAG_LABELS[flag] ?? flag}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* Athlete Check-in Card */}
      <section aria-labelledby="check-in-heading" className="coaching-section">
        <h2 id="check-in-heading">Athlete Check-in</h2>
        <div className="coaching-card">
          {checkIn ? (
            <div className="athlete-checkin-details">
              <div className="athlete-checkin-row">
                <span className="coaching-review-label">Feeling:</span>
                <span className={`roster-pill roster-pill--feeling-${checkIn.feeling}`}>
                  {FEELING_LABELS[checkIn.feeling] ?? checkIn.feeling}
                </span>
              </div>

              {checkIn.niggles ? (
                <div className="athlete-checkin-group">
                  <span className="coaching-review-label">Niggles &amp; Aches:</span>
                  <p className="athlete-checkin-text athlete-checkin-text--niggle">
                    {checkIn.niggles}
                  </p>
                </div>
              ) : null}

              {checkIn.note ? (
                <div className="athlete-checkin-group">
                  <span className="coaching-review-label">Athlete Note:</span>
                  <p className="athlete-checkin-text">{checkIn.note}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="member-note">No check-in submitted by athlete for this week yet.</p>
          )}
        </div>
      </section>

      {/* Weekly Runs Log */}
      <section aria-labelledby="runs-log-heading" className="coaching-section">
        <h2 id="runs-log-heading">Runs Log ({runs.length})</h2>
        {runs.length === 0 ? (
          <p className="member-note">No runs logged for this week.</p>
        ) : (
          <ul className="member-runs">
            {runs.map((item) => (
              <li className="member-run member-run--detailed" key={`${item.source}-${item.ref}`}>
                <div className="member-run-main">
                  <span>
                    <time dateTime={item.on}>{formatDay(item.on)}</time>
                  </span>
                  <span>{formatKm(item.distance as Metres)}</span>
                  <span className="member-run-detail">
                    {formatDuration(item.moving as Seconds)},{' '}
                    {paceOf(item.distance as Metres, item.moving as Seconds)}
                  </span>
                </div>
                {item.note ? (
                  <p className="member-run-note">
                    <span className="member-run-note-label">Run Note:</span> {item.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Week Review Editor */}
      <section aria-labelledby="review-editor-heading" className="coaching-section">
        <div className="coaching-header-row">
          <h2 id="review-editor-heading">Weekly Coach Review</h2>
          {review?.sharedAt ? (
            <span className="coaching-review-date">
              Published on {formatWeek(review.sharedAt.slice(0, 10))}
            </span>
          ) : null}
        </div>

        <form action={saveWeekReviewAction} className="member-form coaching-editor-form">
          <input type="hidden" name="athleteSlug" value={athlete.slug} />
          <input type="hidden" name="weekStart" value={currentWeekStart} />

          <div className="member-field">
            <label htmlFor="field-watch">Watch for Next Week</label>
            <p className="member-hint">Things to watch out for, one item per line</p>
            <textarea
              id="field-watch"
              name="watch"
              rows={4}
              defaultValue={watchPrefill}
              className="member-textarea"
            />
          </div>

          <div className="member-field">
            <label htmlFor="field-recommendations">Recommendations for Next Week</label>
            <p className="member-hint">Training adjustments, recovery cues, one item per line</p>
            <textarea
              id="field-recommendations"
              name="recommendations"
              rows={4}
              defaultValue={recoPrefill}
              className="member-textarea"
            />
          </div>

          <div className="member-field">
            <label htmlFor="field-note">Coach Notes &amp; Feedback</label>
            <p className="member-hint">
              Personalized context, advice, feedback, and encouragement for the week ahead
            </p>
            <textarea
              id="field-note"
              name="note"
              rows={5}
              defaultValue={notePrefill}
              className="member-textarea"
            />
          </div>

          <div>
            <button type="submit" className="button">
              Publish Weekly Review
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
