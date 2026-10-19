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
import type { ReactNode } from 'react'

import { CheckIcon, StaleBadge, StatusBadge } from './badges'
import { BAND_LABELS, DISCIPLINE_LABELS, dateParts, formatDate, formatDates, formatDistance, placeOf } from './format'

declare module 'react' {
  interface CSSProperties {
    '--vt-name'?: string
  }
}

type Props = { heading: string; page: RacePage; query: RaceQuery; today: LocalDate }

const toggle = <T,>(list: readonly T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

const activeFilters = (query: RaceQuery, today: LocalDate): string[] => [
  ...(query.text ? [`“${query.text}”`] : []),
  ...query.disciplines.map((discipline) => DISCIPLINE_LABELS[discipline]),
  ...query.bands.map((band) => BAND_LABELS[band]),
  ...(query.subdivision ? [subdivisionOf(query.subdivision).name] : []),
  ...(query.from === today ? [] : [`From ${formatDate(query.from)}`]),
  ...(query.to ? [`To ${formatDate(query.to)}`] : []),
  ...(query.includeVirtual ? ['Including virtual'] : []),
  ...(query.registrationOpen ? ['Registration open'] : []),
]

export function RaceCalendar({ heading, page, query, today }: Props) {
  const href = (change: Partial<RaceQuery>) => racesHref({ ...query, page: 1, ...change }, today)
  const active = activeFilters(query, today)

  return (
    <div className="page calendar">
      <header className="calendar-head">
        <h1>{heading}</h1>
        <p className="result-count">
          <strong>{page.total === 1 ? '1 race' : `${page.total} races`}</strong>
          {active.length > 0 ? <span className="active-filters">{active.join(' · ')}</span> : null}
        </p>
      </header>

      <button type="button" className="button filters-toggle" popoverTarget="filters">
        Filters
        {active.length > 0 ? <span className="filters-count">{active.length}</span> : null}
      </button>

      <aside id="filters" popover="auto" className="filter-panel" aria-label="Filters">
        <div className="sheet-head">
          <h2>Filters</h2>
          {active.length > 0 ? <a href="/races">Clear all</a> : null}
          <button type="button" className="button button-secondary" popoverTarget="filters" popoverTargetAction="hide">
            Done
          </button>
        </div>

        <nav className="facets" aria-label="Quick filters">
          <ChipGroup label="Discipline">
            {DISCIPLINES.map((discipline) => (
              <Chip
                key={discipline}
                name={`chip-discipline-${discipline}`}
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
                name={`chip-band-${key}`}
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
                name={`chip-state-${subdivision}`}
                href={href({ subdivision: query.subdivision === subdivision ? null : subdivision })}
                selected={query.subdivision === subdivision}
                count={count}
              >
                {subdivisionOf(subdivision).name}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label="Also">
            <Chip name="chip-virtual" href={href({ includeVirtual: !query.includeVirtual })} selected={query.includeVirtual}>
              Include virtual races
            </Chip>
            <Chip name="chip-open" href={href({ registrationOpen: !query.registrationOpen })} selected={query.registrationOpen}>
              Registration open
            </Chip>
          </ChipGroup>
        </nav>

        <FilterForm query={query} />
      </aside>

      <section className="results" aria-label="Races">
        {page.races.length === 0 ? (
          <p className="empty">
            No races match these filters. <a href="/races">See every upcoming race</a>.
          </p>
        ) : (
          <ol className="race-list">
            {page.races.map((race) => (
              <RaceCard key={race.id} race={race} today={today} />
            ))}
          </ol>
        )}

        <Pagination page={page} pageHref={(n) => racesHref({ ...query, page: n }, today)} />
      </section>
    </div>
  )
}

function FilterForm({ query }: { query: RaceQuery }) {
  return (
    <form className="filters" action="/races" method="get">
      <h2>Search and dates</h2>
      <label className="field">
        Search name or city
        <input type="search" name="q" defaultValue={query.text ?? ''} maxLength={100} enterKeyHint="search" />
      </label>
      <div className="field-row">
        <label className="field">
          From
          <input type="date" name="from" defaultValue={query.from} />
        </label>
        <label className="field">
          To
          <input type="date" name="to" defaultValue={query.to ?? ''} />
        </label>
      </div>
      <label className="field">
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
      <fieldset>
        <legend>Also</legend>
        <label className="check">
          <input type="checkbox" name="virtual" value="1" defaultChecked={query.includeVirtual} />
          Include virtual races
        </label>
        <label className="check">
          <input type="checkbox" name="open" value="1" defaultChecked={query.registrationOpen} />
          Registration open
        </label>
      </fieldset>
      <button type="submit" className="button submit">
        Show races
      </button>
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

function Chip({ name, href, selected, count, children }: { name: string; href: string; selected: boolean; count?: number; children: ReactNode }) {
  const label = (
    <>
      {selected ? <CheckIcon /> : null}
      {children}
      {count === undefined ? null : <span className="count">{count}</span>}
    </>
  )
  if (!selected && count === 0) {
    return (
      <li>
        <span className="chip" aria-disabled="true" style={{ '--vt-name': name }}>
          {label}
        </span>
      </li>
    )
  }
  return (
    <li>
      {/* Filtered views are noindex; only links to landing pages are worth following. */}
      <a
        className="chip"
        href={href}
        aria-current={selected ? 'true' : undefined}
        rel={href.includes('?') ? 'nofollow' : undefined}
        style={{ '--vt-name': name }}
      >
        {label}
      </a>
    </li>
  )
}

function RaceCard({ race, today }: { race: PublicRace; today: LocalDate }) {
  const { weekday, day, month } = dateParts(race.dates.start)
  const flagged = race.status.kind !== 'scheduled' || isVerificationStale(race, today)
  return (
    <li className="race-card" data-status={race.status.kind}>
      <div className="date-tile" aria-hidden="true">
        <span className="date-tile-weekday">{weekday}</span>
        <span className="date-tile-day">{day}</span>
        <span className="date-tile-month">{month}</span>
      </div>
      <div className="race-body">
        <h2>
          <a href={`/races/${race.slug}`}>{race.name}</a>
        </h2>
        <p className="race-meta">
          <span>{formatDates(race.dates)}</span>
          <span>{placeOf(race)}</span>
        </p>
        <ul className="distance-tags" aria-label="Distances">
          {race.distances.map((option, index) => (
            <li key={index}>{formatDistance(option)}</li>
          ))}
        </ul>
        {flagged ? (
          <p className="badges">
            <StatusBadge status={race.status} />
            <StaleBadge race={race} today={today} />
          </p>
        ) : null}
      </div>
    </li>
  )
}

function Pagination({ page, pageHref }: { page: RacePage; pageHref: (page: number) => string }) {
  if (page.totalPages <= 1) return null
  return (
    <nav className="pagination" aria-label="Pages">
      {page.page > 1 ? (
        <a className="pill" href={pageHref(page.page - 1)} rel="prev">
          Previous
        </a>
      ) : (
        <span />
      )}
      <span className="pagination-status">{`Page ${page.page} of ${page.totalPages}`}</span>
      {page.page < page.totalPages ? (
        <a className="pill" href={pageHref(page.page + 1)} rel="next">
          Next
        </a>
      ) : (
        <span />
      )}
    </nav>
  )
}
