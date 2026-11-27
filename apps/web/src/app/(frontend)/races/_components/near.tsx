import { CITIES, INDIAN_SUBDIVISIONS, type City, type LocalDate, type NearRace, type PublicRace, type RaceDistance } from '@erc/domain'
import React from 'react'

import { RaceCard } from './race-calendar'

import './races.css'

const BY_STATE = INDIAN_SUBDIVISIONS.map(({ code, name }) => ({
  name,
  cities: CITIES.filter((city) => city.subdivision === code).sort((a, b) => a.name.localeCompare(b.name)),
}))
  .filter(({ cities }) => cities.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name))

/** Every city in the table, grouped by state, so a runner scanning for their own finds it under the state they know. */
export function CityOptions({ placeholder }: { placeholder: string }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {BY_STATE.map(({ name, cities }) => (
        <optgroup key={name} label={name}>
          {cities.map((city) => (
            <option key={city.slug} value={city.slug}>
              {city.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

// Under 20 km the city itself is the honest answer; beyond that, tens of kilometres are all a straight line can promise.
const roundKm = (km: number) => (km < 20 ? Math.max(1, Math.round(km)) : Math.round(km / 10) * 10)

/**
 * "In Pune", "~120 km away", or why there is no number. Every figure is a straight line between city centres; one
 * measured to the state capital, because the race's own town is not in the table, says it is approximate.
 */
export const formatRaceDistance = (distance: RaceDistance, origin: City): string => {
  if (distance.kind === 'unknown') return 'Distance unknown'
  if (distance.kind === 'city') return distance.city.slug === origin.slug ? `In ${origin.name}` : `~${roundKm(distance.km)} km away`
  return distance.km < 20 ? `Near ${distance.capital.name} (approx.)` : `~${roundKm(distance.km)} km away (approx.)`
}

/** A plain GET form, so choosing a city works without JavaScript. An empty choice goes back to the full calendar. */
export function NearForm({ selected }: { selected: City | null }) {
  return (
    <form className="near-form" action="/races" method="get">
      <label className="field">
        Races near
        <select name="near" defaultValue={selected?.slug ?? ''}>
          <CityOptions placeholder="Choose a city" />
        </select>
      </label>
      <button type="submit" className="button button-secondary">
        Show nearest
      </button>
    </form>
  )
}

export function NearRaces({ origin, races, today, homeCity }: { origin: City; races: readonly NearRace<PublicRace>[]; today: LocalDate; homeCity: City | null }) {
  return (
    <div className="page near">
      <header className="calendar-head">
        <h1>Races near {origin.name}</h1>
        <p className="result-count">
          <strong>{races.length === 1 ? '1 upcoming race' : `${races.length} upcoming races`}</strong>
          <span>nearest first, as the crow flies between city centres</span>
        </p>
        <NearForm selected={origin} />
        {homeCity && homeCity.slug !== origin.slug ? (
          <p className="near-note">
            <a href={`/races?near=${homeCity.slug}`}>Back to races near {homeCity.name}</a>, your home city.
          </p>
        ) : null}
      </header>
      {races.length === 0 ? (
        <p className="empty">
          No upcoming races are listed yet. <a href="/races">See the full calendar</a>.
        </p>
      ) : (
        <ol className="race-list">
          {races.map(({ race, distance }) => (
            <RaceCard key={race.id} race={race} today={today} distance={formatRaceDistance(distance, origin)} />
          ))}
        </ol>
      )}
      <p className="near-note">
        <a href="/races">See every upcoming race in date order</a>
      </p>
    </div>
  )
}
