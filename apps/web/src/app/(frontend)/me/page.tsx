import { randomUUID } from 'node:crypto'

import type { MyAthlete, MyCoachingView, PeriodTotals, StravaStatusView } from '@erc/contract'
import { formatDuration, formatKm, type LocalDate, type Metres, type Seconds } from '@erc/domain'
import type { Metadata } from 'next'
import React from 'react'

import { signOut, signOutDevice } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import { disconnectStravaAction, joinStravaWaitlistAction, syncStravaAction } from './actions'
import { RunForm } from './run-form'

import './members.css'

export const metadata: Metadata = { title: 'My running', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ after?: string | string[]; strava?: string | string[] }> }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

const STRAVA_NOTICES: Record<string, { message: string; type: 'success' | 'alert' }> = {
  connected: {
    message: 'Strava connected! Your runs from the past 90 days have been synced.',
    type: 'success',
  },
  waitlisted: {
    message: "You've been added to the Strava pilot waitlist.",
    type: 'success',
  },
  denied: {
    message: 'Strava authorization was cancelled.',
    type: 'alert',
  },
  error: {
    message: 'An error occurred while connecting to Strava. Please try again.',
    type: 'alert',
  },
}

// A LocalDate is a calendar fact, so it is formatted as a UTC date and never shifted by the server's zone.
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDay = (date: LocalDate | string) => day.format(new Date(`${date}T00:00:00Z`))

const paceOf = (distance: Metres, moving: Seconds) => `${formatDuration(Math.round(moving / (distance / 1000)) as Seconds)} /km`

// Session dates are instants, shown as club dates so a member in India reads the day they remember.
const clubDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
const formatInstant = (instant: string) => clubDay.format(new Date(instant))

function Stat({ title, period }: { title: string; period: PeriodTotals }) {
  const { totals } = period
  return (
    <section className="member-stat" aria-labelledby={`stat-${period.kind}`}>
      <h2 id={`stat-${period.kind}`}>{title}</h2>
      <p className="member-stat-value">{formatKm(totals.distance)}</p>
      <p className="member-stat-detail">
        {totals.runs === 1 ? '1 run' : `${totals.runs} runs`}
        {totals.runs > 0 ? `, ${formatDuration(totals.moving)}` : ''}
        <br />
        {formatDay(period.first)} to {formatDay(period.last)}
      </p>
    </section>
  )
}

/** One line on where the member stands, with the way to the page that changes it. */
function AthleteSummary({ athlete }: { athlete: MyAthlete }) {
  const line =
    athlete.kind === 'claim_pending'
      ? `Your claim on ${athlete.athlete.name} is waiting for a coach to review it.`
      : athlete.kind === 'none'
        ? athlete.rejectedClaim
          ? `Your claim on ${athlete.rejectedClaim.athleteName} was not approved: ${athlete.rejectedClaim.reason}`
          : 'Claim the profile a coach made for you, or start one, to show your racing on the site.'
        : athlete.profile.moderation.state === 'submitted'
          ? `Your profile, ${athlete.profile.values.name}, is waiting for a coach to review it.`
          : athlete.profile.moderation.state === 'rejected'
            ? `Your profile was not approved: ${athlete.profile.moderation.reason}`
            : athlete.profile.publicPath
              ? `Your profile, ${athlete.profile.values.name}, is public.`
              : `Your profile, ${athlete.profile.values.name}, is hidden.`
  const pending = athlete.kind === 'profile' ? athlete.profile.changes.filter((change) => change.state === 'submitted').length : 0
  return (
    <section aria-labelledby="athlete">
      <h2 id="athlete">Athlete profile</h2>
      <p>
        {line}
        {pending > 0 ? ` ${pending === 1 ? 'One change is' : `${pending} changes are`} waiting for review.` : ''}{' '}
        <a href="/me/athlete">{athlete.kind === 'profile' ? 'Manage your profile' : 'Find or start your profile'}</a>
      </p>
    </section>
  )
}

function CoachingSection({ coaching }: { coaching: MyCoachingView }) {
  const { link, coach, currentReview, currentCheckIn } = coaching
  const hasCoach = coach && link && (link.state === 'active' || link.state === 'requested')

  if (!hasCoach) {
    return (
      <section className="coaching-section" aria-labelledby="coaching-heading">
        <h2 id="coaching-heading">Coaching</h2>
        <div className="coaching-card coaching-card--empty">
          <div>
            <h3 className="coaching-card-title">Work with a club coach</h3>
            <p className="coaching-card-desc">
              Connect with an ERC coach to receive weekly reviews, training adjustments, and check-in feedback.
            </p>
          </div>
          <a href="/me/coaching" className="button button-secondary">
            Find a coach
          </a>
        </div>
      </section>
    )
  }

  const isActive = link.state === 'active'

  return (
    <section className="coaching-section" aria-labelledby="coaching-heading">
      <div className="coaching-header-row">
        <h2 id="coaching-heading">Coaching</h2>
        <a href="/me/coaching" className="coaching-manage-link">
          Manage coaching
        </a>
      </div>

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
              <span className={`coaching-status-badge ${isActive ? 'coaching-status-badge--active' : 'coaching-status-badge--pending'}`}>
                {isActive ? 'Active Coach' : 'Request Pending'}
              </span>
            </div>
            {coach.credentials ? <p className="coaching-coach-credentials">{coach.credentials}</p> : null}
          </div>
        </div>

        {isActive ? (
          <div className="coaching-checkin-status">
            <div className="coaching-checkin-text">
              <span className="coaching-subhead">This week&apos;s check-in</span>
              {currentCheckIn ? (
                <p className="coaching-checkin-submitted">
                  Submitted (Feeling: <strong>{currentCheckIn.feeling}</strong>
                  {currentCheckIn.niggles ? ` • Niggles noted` : ''})
                </p>
              ) : (
                <p className="coaching-checkin-missing">Not submitted yet for this week.</p>
              )}
            </div>
            <a href="/me/check-in" className="button button-secondary">
              {currentCheckIn ? 'Update check-in' : 'Submit check-in'}
            </a>
          </div>
        ) : (
          <p className="coaching-pending-note">
            Waiting for {coach.name} to accept your coaching request.
          </p>
        )}

        {isActive && currentReview && (currentReview.watch.length > 0 || currentReview.recommendations.length > 0 || currentReview.note) ? (
          <div className="coaching-review-card">
            <div className="coaching-review-header">
              <h4 className="coaching-review-title">Coach Weekly Review</h4>
              <span className="coaching-review-date">Week of {formatDay(currentReview.weekStart)}</span>
            </div>

            {currentReview.watch.length > 0 ? (
              <div className="coaching-review-group">
                <span className="coaching-review-label">Watch items</span>
                <ul className="coaching-pill-list">
                  {currentReview.watch.map((item, i) => (
                    <li key={i} className="coaching-pill coaching-pill--watch">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {currentReview.recommendations.length > 0 ? (
              <div className="coaching-review-group">
                <span className="coaching-review-label">Recommendations</span>
                <ul className="coaching-pill-list">
                  {currentReview.recommendations.map((item, i) => (
                    <li key={i} className="coaching-pill coaching-pill--reco">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {currentReview.note ? (
              <div className="coaching-review-group">
                <span className="coaching-review-label">Coach Note</span>
                <p className="coaching-review-note">{currentReview.note}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function formatRelativeTime(instant: string): string {
  try {
    const diffMs = Date.now() - new Date(instant).getTime()
    if (isNaN(diffMs)) return clubDay.format(new Date(instant))
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return 'just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} ${diffHr === 1 ? 'hour' : 'hours'} ago`
    const diffDays = Math.floor(diffHr / 24)
    if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`
    return clubDay.format(new Date(instant))
  } catch {
    return instant
  }
}

function StravaSection({ strava }: { strava: StravaStatusView }) {
  if (!strava.enabled) return null

  return (
    <section aria-labelledby="strava-heading" className="strava-section">
      <h2 id="strava-heading">Strava sync</h2>

      <div className="strava-card">
        {strava.status === 'disconnected' && !strava.isAtCap ? (
          <>
            <div className="strava-header">
              <div>
                <h3 className="strava-title">Connect with Strava</h3>
                <p className="strava-desc">
                  Automatically sync your runs from Strava into your private ERC training log.
                </p>
              </div>
            </div>
            <div className="strava-actions">
              <a href="/api/v1/strava/connect" className="button btn-strava">
                Connect with Strava
              </a>
            </div>
          </>
        ) : null}

        {strava.status === 'disconnected' && strava.isAtCap ? (
          <>
            <div className="strava-banner strava-banner--info">
              <span>
                <strong>Strava Pilot at Capacity ({strava.connectedCount}/{strava.cap})</strong>
                <br />
                The Strava pilot is currently full. Join the waitlist to be notified when capacity expands.
              </span>
            </div>
            <div className="strava-actions">
              <form action={joinStravaWaitlistAction}>
                <button type="submit" className="button btn-strava">
                  Join Waitlist
                </button>
              </form>
            </div>
          </>
        ) : null}

        {strava.status === 'waitlisted' ? (
          <>
            <div className="strava-banner strava-banner--info">
              <span>
                <strong>You are on the Strava waitlist (#{strava.waitlistPosition ?? 1})</strong>
                <br />
                We will connect your account as soon as capacity expands in the pilot.
              </span>
            </div>
            <div className="strava-actions">
              <form action={disconnectStravaAction}>
                <button type="submit" className="button button-secondary">
                  Leave Waitlist
                </button>
              </form>
            </div>
          </>
        ) : null}

        {strava.status === 'connected' ? (
          <>
            <div className="strava-header">
              <div>
                <h3 className="strava-title">Strava Connected</h3>
                <p className="strava-meta">
                  Last synced: {strava.lastSyncedAt ? formatRelativeTime(strava.lastSyncedAt) : 'Never'}
                </p>
              </div>
              <span className="strava-badge strava-badge--connected">
                Connected (Athlete #{strava.athleteId})
              </span>
            </div>
            <div className="strava-actions">
              <form action={syncStravaAction}>
                <button type="submit" className="button btn-strava">
                  Sync Now
                </button>
              </form>
              <form action={disconnectStravaAction}>
                <button type="submit" className="button button-secondary">
                  Disconnect
                </button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

export default async function MePage({ searchParams }: Props) {
  const caller = await requireMember()
  const search = await searchParams
  const after = first(search.after)
  const stravaNoticeKey = first(search.strava)
  const stravaNotice = stravaNoticeKey ? STRAVA_NOTICES[stravaNoticeKey] : null

  const [dashboard, runs, devices, coaching, strava] = await Promise.all([
    run('dashboard', caller, {}),
    run('listRuns', caller, { after }),
    run('listSessions', caller, {}),
    run('myCoaching', caller, {}),
    run('stravaStatus', caller, {}),
  ])
  if (!dashboard.ok || !runs.ok || !devices.ok || !coaching.ok) {
    const failed = [dashboard, runs, devices, coaching].find((result) => !result.ok)
    return (
      <div className="page member-page">
        <h1>My running</h1>
        <p className="member-alert" role="alert">
          {failed && !failed.ok ? (failed.error.fields ? Object.values(failed.error.fields).join(' ') : failed.error.message) : ''}
        </p>
      </div>
    )
  }
  const stravaView = strava.ok ? strava.data : null
  const { week, month, today, member } = dashboard.data
  return (
    <div className="page member-page">
      <header>
        <h1>My running</h1>
        <div className="member-lede">
          Signed in as {member.email}.{' '}
          <form className="member-signout" action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {stravaNotice ? (
        <aside
          className={`strava-banner ${stravaNotice.type === 'alert' ? 'strava-banner--error' : 'strava-banner--success'}`}
          role="status"
        >
          {stravaNotice.message}
        </aside>
      ) : null}

      {caller.session.coachId !== null ? (
        <aside className="coach-banner" aria-label="Coach navigation">
          <span>You are an ERC coach</span>
          <a href="/me/coach">Go to Coach Roster &rarr;</a>
        </aside>
      ) : null}

      {coaching.data.link?.state === 'active' && coaching.data.coach ? (
        <aside className="coach-banner" aria-label="Coach status">
          <span>Your Coach: <strong>{coaching.data.coach.name}</strong></span>
          <a href="/me/coaching">Manage coaching &rarr;</a>
        </aside>
      ) : null}

      <div className="member-stats">
        <Stat title="This week" period={week} />
        <Stat title="This month" period={month} />
      </div>

      <AthleteSummary athlete={dashboard.data.athlete} />

      <CoachingSection coaching={coaching.data} />

      {stravaView && stravaView.enabled ? <StravaSection strava={stravaView} /> : null}

      <section aria-labelledby="log-run">
        <h2 id="log-run">Log a run</h2>
        <RunForm initial={{ ref: randomUUID(), values: { date: today, distanceKm: '', duration: '', note: '' } }} today={today} />
      </section>

      <section aria-labelledby="recent-runs">
        <h2 id="recent-runs">{after ? 'Older runs' : 'Recent runs'}</h2>
        {runs.data.items.length === 0 ? (
          <p className="member-note">{after ? 'No older runs.' : 'Nothing logged yet. Your first run goes above.'}</p>
        ) : (
          <ul className="member-runs">
            {runs.data.items.map((item) => (
              <li className="member-run" key={`${item.source}-${item.ref}`}>
                <span>
                  <time dateTime={item.on}>{formatDay(item.on)}</time>
                </span>
                <span>{formatKm(item.distance as Metres)}</span>
                <span className="member-run-detail">
                  {formatDuration(item.moving as Seconds)}, {paceOf(item.distance as Metres, item.moving as Seconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="member-row">
          {runs.data.next ? <a href={`/me?after=${encodeURIComponent(runs.data.next)}#recent-runs`}>Older runs</a> : null}
          {after ? <a href="/me#recent-runs">Back to recent runs</a> : null}
        </p>
      </section>

      <section aria-labelledby="devices">
        <h2 id="devices">Signed-in devices</h2>
        <p className="member-note">Signing out a device you no longer have ends its session straight away. Nothing else here changes.</p>
        <ul className="member-devices">
          {devices.data.items.map((device) => (
            <li className="member-device" key={device.id}>
              <span className="member-device-label">
                {device.label}
                {device.current ? <span className="member-device-current"> (this device)</span> : null}
              </span>
              <span className="member-device-detail">
                Signed in {formatInstant(device.createdAt)}, last used {formatInstant(device.lastSeenAt)}
              </span>
              {device.current ? null : (
                <form className="member-signout" action={signOutDevice}>
                  <input type="hidden" name="session" value={device.id} />
                  <button type="submit">Sign out this device</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
