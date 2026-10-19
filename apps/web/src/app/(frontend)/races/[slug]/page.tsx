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
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getRace } from '@/content/races'

import {
  DISCIPLINE_LABELS,
  formatCutoff,
  formatDate,
  formatDates,
  formatDistance,
  placeOf,
  sourceLabel,
  statusBadge,
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
    description: `${formatDates(race.dates)}, ${placeOf(race)}. ${race.summary}`,
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
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: race.name,
    description: race.summary,
    sport: 'Running',
    startDate: start,
    endDate: addDays(start, race.dates.dayCount - 1),
    url: race.officialUrl,
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

// JSON.stringify leaves `<` alone, so a race name containing `</script>` could otherwise end the tag early.
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export default async function RacePage({ params }: Props) {
  const race = await raceOf(params)
  const today = todayIn('Asia/Kolkata')
  const status = statusBadge(race.status)
  const source = sourceLabel(race.source)
  const stale = isVerificationStale(race, today)

  return (
    <article className="races race-detail">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(sportsEvent(race)) }} />
      <p>
        <Link href="/races">All races</Link>
      </p>
      <h1>{race.name}</h1>
      {status ? (
        <p className="badges">
          <span className={`badge badge-${race.status.kind}`}>{status}</span>
          {race.status.kind === 'postponed' ? (
            <span> {race.status.newStart ? `New date: ${formatDate(race.status.newStart)}` : 'New date not announced yet'}</span>
          ) : null}
        </p>
      ) : null}
      <p className="race-summary">{race.summary}</p>

      <dl className="race-facts">
        <dt>Date</dt>
        <dd>{formatDates(race.dates)}</dd>
        <dt>Location</dt>
        <dd>{race.location.kind === 'virtual' ? 'Virtual' : `${race.location.venue}, ${placeOf(race)}`}</dd>
        <dt>Discipline</dt>
        <dd>{DISCIPLINE_LABELS[race.discipline]}</dd>
        <dt>Registration closes</dt>
        <dd>{race.registration.closesOn ? formatDate(race.registration.closesOn) : 'Not announced'}</dd>
        <dt>Register</dt>
        <dd>
          <a href={race.registration.url} rel="noopener">
            Registration page
          </a>
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
        <dd>
          {formatDate(race.lastVerifiedOn)}
          {stale ? <span className="badge badge-stale">Not recently checked</span> : null}
        </dd>
      </dl>

      <h2>Distances</h2>
      <table className="distances">
        <thead>
          <tr>
            <th scope="col">Distance</th>
            <th scope="col">Elevation gain</th>
            <th scope="col">Terrain</th>
            <th scope="col">Cutoff</th>
          </tr>
        </thead>
        <tbody>
          {race.distances.map((option, index) => (
            <tr key={index}>
              <td>{formatDistance(option)}</td>
              <td>{option.elevationGainMetres === undefined ? '' : `${option.elevationGainMetres} m`}</td>
              <td>{option.terrain ? terrainLabel(option.terrain) : ''}</td>
              <td>{option.cutoff === undefined ? '' : formatCutoff(option.cutoff)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add to calendar</h2>
      <ul className="calendar-links">
        <li>
          <a href={`/races/${race.slug}/calendar.ics`}>Download calendar file (.ics)</a>
        </li>
        <li>
          <a href={googleCalendarUrl(race)} rel="noopener">
            Add to Google Calendar
          </a>
        </li>
      </ul>
    </article>
  )
}
