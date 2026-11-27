import {
  addDays,
  googleCalendarUrl,
  isVerificationStale,
  subdivisionOf,
  todayIn,
  type PublicRace,
  type RaceStatus,
} from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getRace } from '@/content/races'
import { absoluteUrl } from '@/site-config'

import { QuestionsSection, ReviewsSection } from '../../_feedback/feedback'
import { breadcrumbList, JsonLd } from '../../structured-data'

import { StaleBadge, StatusBadge } from '../_components/badges'
import {
  DISCIPLINE_LABELS,
  formatCutoff,
  formatDate,
  formatDates,
  formatDistance,
  placeOf,
  sourceLabel,
  terrainLabel,
} from '../_components/format'

import '../_components/races.css'

type Props = { params: Promise<{ slug: string }> }

const raceOf = async (params: Props['params']) => {
  const race = await getRace((await params).slug)
  if (!race) notFound()
  return race
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const race = await raceOf(params)
  return {
    title: race.name,
    description: `${formatDates(currentDates(race))}, ${placeOf(race)}. ${race.summary}`,
    alternates: { canonical: `/races/${race.slug}` },
  }
}

const EVENT_STATUS: Record<RaceStatus['kind'], string> = {
  scheduled: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
}

const sportsEvent = (race: PublicRace) => {
  const rescheduledTo = race.status.kind === 'postponed' ? race.status.newStart : null
  const start = rescheduledTo ?? race.dates.start
  return {
    '@type': 'SportsEvent',
    name: race.name,
    ...(race.summary ? { description: race.summary } : {}),
    sport: 'Running',
    startDate: start,
    endDate: addDays(start, race.dates.dayCount - 1),
    url: absoluteUrl(`/races/${race.slug}`),
    sameAs: race.officialUrl,
    eventStatus: rescheduledTo ? 'https://schema.org/EventRescheduled' : EVENT_STATUS[race.status.kind],
    ...(rescheduledTo ? { previousStartDate: race.dates.start } : {}),
    ...(race.location.kind === 'virtual'
      ? {
          eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
          location: { '@type': 'VirtualLocation', url: race.officialUrl },
        }
      : {
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          location: {
            '@type': 'Place',
            name: race.location.venue,
            address: {
              '@type': 'PostalAddress',
              addressLocality: race.location.city,
              addressRegion: subdivisionOf(race.location.subdivision).name,
              addressCountry: race.location.country,
            },
          },
        }),
  }
}

/** A postponed race leads with its new date, as its badge does; the original date stays visible but secondary. */
function RaceDates({ race }: { race: PublicRace }) {
  if (race.status.kind !== 'postponed') return formatDates(race.dates)
  return (
    <>
      {race.status.newStart ? formatDates(currentDates(race)) : 'New date not announced'}
      <span className="original-date">originally {formatDates(race.dates)}</span>
    </>
  )
}

const currentDates = (race: PublicRace): PublicRace['dates'] =>
  race.status.kind === 'postponed' && race.status.newStart ? { ...race.dates, start: race.status.newStart } : race.dates

export default async function RacePage({ params }: Props) {
  const race = await raceOf(params)
  const today = todayIn('Asia/Kolkata')
  const registrationClosed = race.registration.closesOn !== null && race.registration.closesOn < today
  const columns = {
    elevation: race.distances.some((option) => option.elevationGainMetres !== undefined),
    terrain: race.distances.some((option) => option.terrain),
    cutoff: race.distances.some((option) => option.cutoff !== undefined),
  }
  const source = sourceLabel(race.source)
  const flagged = race.status.kind !== 'scheduled' || isVerificationStale(race, today)

  return (
    <article className="page race-detail">
      <JsonLd
        data={{
          '@graph': [
            sportsEvent(race),
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Races', path: '/races' },
              { name: race.name, path: `/races/${race.slug}` },
            ]),
          ],
        }}
      />
      <header className="race-detail-head">
        <a className="back-link" href="/races">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
          All races
        </a>
        <h1>{race.name}</h1>
        {flagged ? (
          <p className="badges">
            <StatusBadge status={race.status} />
            <StaleBadge race={race} today={today} />
          </p>
        ) : null}
        <p className="race-summary">{race.summary}</p>
        <ul className="cta-row">
          {registrationClosed ? null : (
            <li>
              <a className="button" href={race.registration.url} rel="noopener">
                Register
              </a>
            </li>
          )}
          <li>
            <a className="button button-secondary" href={race.officialUrl} rel="noopener">
              Official website
            </a>
          </li>
        </ul>
      </header>

      <dl className="race-facts">
        <dt>Date</dt>
        <dd>
          <RaceDates race={race} />
        </dd>
        <dt>Location</dt>
        <dd>{race.location.kind === 'virtual' ? 'Virtual' : race.location.venue === race.location.city ? placeOf(race) : `${race.location.venue}, ${placeOf(race)}`}</dd>
        <dt>Discipline</dt>
        <dd>{DISCIPLINE_LABELS[race.discipline]}</dd>
        <dt>Registration closes</dt>
        <dd>
          {race.registration.closesOn
            ? `${registrationClosed ? 'Closed ' : ''}${formatDate(race.registration.closesOn)}`
            : 'Not announced'}
        </dd>
        <dt>Official website</dt>
        <dd>
          <a href={race.officialUrl} rel="noopener">
            {new URL(race.officialUrl).hostname}
          </a>
        </dd>
        <dt>Source</dt>
        <dd>
          {source.url ? (
            <a href={source.url} rel="noopener">
              {source.text}
            </a>
          ) : (
            source.text
          )}
        </dd>
        <dt>Last checked</dt>
        <dd>{formatDate(race.lastVerifiedOn)}</dd>
      </dl>

      <section>
        <h2 id="distances-heading">Distances</h2>
        <div className="table-scroll" role="region" aria-labelledby="distances-heading" tabIndex={0}>
          <table className="distances">
            <thead>
              <tr>
                <th scope="col">Distance</th>
                {columns.elevation ? <th scope="col">Elevation gain</th> : null}
                {columns.terrain ? <th scope="col">Terrain</th> : null}
                {columns.cutoff ? <th scope="col">Cutoff</th> : null}
              </tr>
            </thead>
            <tbody>
              {race.distances.map((option, index) => (
                <tr key={index}>
                  <td>{formatDistance(option)}</td>
                  {columns.elevation ? (
                    <td>{option.elevationGainMetres === undefined ? '' : `${option.elevationGainMetres} m`}</td>
                  ) : null}
                  {columns.terrain ? <td>{option.terrain ? terrainLabel(option.terrain) : ''}</td> : null}
                  {columns.cutoff ? <td>{option.cutoff === undefined ? '' : formatCutoff(option.cutoff)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Add to calendar</h2>
        <ul className="cta-row">
          <li>
            <a className="button button-secondary" href={`/races/${race.slug}/calendar.ics`}>
              Download calendar file (.ics)
            </a>
          </li>
          <li>
            <a className="button button-secondary" href={googleCalendarUrl(race)} rel="noopener">
              Add to Google Calendar
            </a>
          </li>
        </ul>
      </section>

      <ReviewsSection subject={{ kind: 'races', id: race.id }} path={`/races/${race.slug}`} noun="race" />
      <QuestionsSection race={race.id} />
    </article>
  )
}
