import { randomUUID } from 'node:crypto'

import type { PeriodTotals } from '@erc/contract'
import { formatDuration, formatKm, type LocalDate, type Metres, type Seconds } from '@erc/domain'
import type { Metadata } from 'next'
import React from 'react'

import { signOut } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import { RunForm } from './run-form'

import './members.css'

export const metadata: Metadata = { title: 'My running', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ after?: string | string[] }> }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

// A LocalDate is a calendar fact, so it is formatted as a UTC date and never shifted by the server's zone.
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDay = (date: LocalDate | string) => day.format(new Date(`${date}T00:00:00Z`))

const paceOf = (distance: Metres, moving: Seconds) => `${formatDuration(Math.round(moving / (distance / 1000)) as Seconds)} /km`

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

export default async function MePage({ searchParams }: Props) {
  const caller = await requireMember()
  const after = first((await searchParams).after)
  const [dashboard, runs] = await Promise.all([run('dashboard', caller, {}), run('listRuns', caller, { after })])
  if (!dashboard.ok || !runs.ok) {
    return (
      <div className="page member-page">
        <h1>My running</h1>
        <p className="member-alert" role="alert">
          {dashboard.ok ? (runs.ok ? '' : runs.error.message) : dashboard.error.message}
        </p>
      </div>
    )
  }
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

      <div className="member-stats">
        <Stat title="This week" period={week} />
        <Stat title="This month" period={month} />
      </div>

      <section aria-labelledby="log-run">
        <h2 id="log-run">Log a run</h2>
        <RunForm initial={{ ref: randomUUID(), values: { date: today, distanceKm: '', duration: '' } }} today={today} />
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
    </div>
  )
}
