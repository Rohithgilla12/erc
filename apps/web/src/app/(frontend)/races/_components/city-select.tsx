import { CITIES, INDIAN_SUBDIVISIONS, type City, type RaceDistance } from '@erc/domain'
import React from 'react'

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
  return distance.km < 20 ? 'Under 20 km away (approx.)' : `~${roundKm(distance.km)} km away (approx.)`
}
