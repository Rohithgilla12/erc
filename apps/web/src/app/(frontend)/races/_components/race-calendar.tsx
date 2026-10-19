import {
  DISCIPLINES,
  DISTANCE_BANDS,
  INDIAN_SUBDIVISIONS,
  isVerificationStale,
  racesHref,
  subdivisionOf,
  type LocalDate,
  type PublicRace,
  type RacePage,
  type RaceQuery,
} from '@erc/domain'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { BAND_LABELS, DISCIPLINE_LABELS, formatDates, formatDistance, placeOf, statusBadge } from './format'

type Props = { heading: string; page: RacePage; query: RaceQuery; today: LocalDate }

const toggle = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

export function RaceCalendar({ heading, page, query, today }: Props) {
  const href = (change: Partial<RaceQuery>) => racesHref({ ...query, page: 1, ...change }, today)

  return (
    <div className="races">
      <h1>{heading}</h1>

      <FilterForm query={query} />

      <nav className="facets" aria-label="Filters">
        <ChipGroup label="Discipline">
          {DISCIPLINES.map((discipline) => (
            <Chip
              key={discipline}
              href={href({ disciplines: toggle(query.disciplines, discipline) })}
              selected={query.disciplines.includes(discipline)}
              count={page.facets.disciplines[discipline] ?? 0}
            >
              {DISCIPLINE_LABELS[discipline]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Distance">
          {DISTANCE_BANDS.map(({ key }) => (
            <Chip
              key={key}
              href={href({ bands: toggle(query.bands, key) })}
              selected={query.bands.includes(key)}
              count={page.facets.bands[key] ?? 0}
            >
              {BAND_LABELS[key]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="State">
          {page.facets.subdivisions.map(({ subdivision, count }) => (
            <Chip
              key={subdivision}
              href={href({ subdivision: query.subdivision === subdivision ? null : subdivision })}
              selected={query.subdivision === subdivision}
              count={count}
            >
              {subdivisionOf(subdivision).name}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Also">
          <Chip href={href({ includeVirtual: !query.includeVirtual })} selected={query.includeVirtual}>
            Include virtual races
          </Chip>
          <Chip href={href({ registrationOpen: !query.registrationOpen })} selected={query.registrationOpen}>
            Registration open
          </Chip>
        </ChipGroup>
      </nav>

      <p className="result-count">{page.total === 1 ? '1 race' : `${page.total} races`}</p>

      {page.races.length === 0 ? (
        <p className="empty">
          No races match these filters. <Link href="/races">See every upcoming race</Link>.
        </p>
      ) : (
        <ol className="race-list">
          {page.races.map((race) => (
            <RaceCard key={race.id} race={race} today={today} />
          ))}
        </ol>
      )}

      <Pagination page={page} pageHref={(n) => racesHref({ ...query, page: n }, today)} />
    </div>
  )
}

function FilterForm({ query }: { query: RaceQuery }) {
  return (
    <form className="filters" action="/races" method="get">
      <label>
        Search name or city
        <input type="search" name="q" defaultValue={query.text ?? ''} maxLength={100} />
      </label>
      <div className="filters-row">
        <label>
          From
          <input type="date" name="from" defaultValue={query.from} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={query.to ?? ''} />
        </label>
      </div>
      <label>
        State
        <select name="state" defaultValue={query.subdivision ?? ''}>
          <option value="">Any state</option>
          {INDIAN_SUBDIVISIONS.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Discipline</legend>
        {DISCIPLINES.map((discipline) => (
          <label key={discipline} className="check">
            <input type="checkbox" name="discipline" value={discipline} defaultChecked={query.disciplines.includes(discipline)} />
            {DISCIPLINE_LABELS[discipline]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Distance</legend>
        {DISTANCE_BANDS.map(({ key }) => (
          <label key={key} className="check">
            <input type="checkbox" name="band" value={key} defaultChecked={query.bands.includes(key)} />
            {BAND_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" name="virtual" value="1" defaultChecked={query.includeVirtual} />
        Include virtual races
      </label>
      <label className="check">
        <input type="checkbox" name="open" value="1" defaultChecked={query.registrationOpen} />
        Registration open
      </label>
      <button type="submit">Show races</button>
    </form>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chip-group">
      <h2>{label}</h2>
      <ul className="chips">{children}</ul>
    </div>
  )
}

function Chip({ href, selected, count, children }: { href: string; selected: boolean; count?: number; children: ReactNode }) {
  const label = (
    <>
      {children}
      {count === undefined ? null : <span className="count">{count}</span>}
    </>
  )
  if (!selected && count === 0) {
    return (
      <li>
        <span className="chip" aria-disabled="true">
          {label}
        </span>
      </li>
    )
  }
  return (
    <li>
      {/* Filtered views are noindex; only links to landing pages are worth following. */}
      <a className="chip" href={href} aria-current={selected ? 'true' : undefined} rel={href.includes('?') ? 'nofollow' : undefined}>
        {label}
      </a>
    </li>
  )
}

function RaceCard({ race, today }: { race: PublicRace; today: LocalDate }) {
  const status = statusBadge(race.status)
  return (
    <li className="race-card">
      <p className="race-date">{formatDates(race.dates)}</p>
      <h2>
        <Link href={`/races/${race.slug}`}>{race.name}</Link>
      </h2>
      <p className="race-place">{placeOf(race)}</p>
      <p className="race-distances">{race.distances.map(formatDistance).join(' · ')}</p>
      {status || isVerificationStale(race, today) ? (
        <p className="badges">
          {status ? <span className={`badge badge-${race.status.kind}`}>{status}</span> : null}
          {isVerificationStale(race, today) ? <span className="badge badge-stale">Not recently checked</span> : null}
        </p>
      ) : null}
    </li>
  )
}

function Pagination({ page, pageHref }: { page: RacePage; pageHref: (page: number) => string }) {
  if (page.totalPages <= 1) return null
  return (
    <nav className="pagination" aria-label="Pages">
      {page.page > 1 ? <a href={pageHref(page.page - 1)}>Previous</a> : <span />}
      <span>{`Page ${page.page} of ${page.totalPages}`}</span>
      {page.page < page.totalPages ? <a href={pageHref(page.page + 1)}>Next</a> : <span />}
    </nav>
  )
}
