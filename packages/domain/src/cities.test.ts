import { describe, expect, it } from 'vitest'

import {
  capitalOf,
  CITIES,
  cityBySlug,
  cityNamed,
  distanceKm,
  INDIAN_SUBDIVISIONS,
  nearestRaces,
  parseHomeCity,
  type City,
  type LocalDate,
  type RaceLocation,
  type Subdivision,
} from './index'

const named = (name: string): City => {
  const found = cityNamed(name)
  if (!found) throw new Error(`${name} is not in CITIES`)
  return found
}

describe('CITIES', () => {
  it('has unique slugs and aliases, each a lower-case hyphenated word', () => {
    const keys = CITIES.flatMap((entry) => [entry.slug, ...entry.aliases])
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((key) => !/^[a-z]+(-[a-z]+)*$/.test(key))).toEqual([])
  })

  it('places every city inside India to two decimal places', () => {
    const outside = CITIES.filter(({ lat, lng }) => lat < 6 || lat > 36 || lng < 68 || lng > 98)
    const tooPrecise = CITIES.filter(({ lat, lng }) => Number(lat.toFixed(2)) !== lat || Number(lng.toFixed(2)) !== lng)
    expect([...outside, ...tooPrecise].map((entry) => entry.slug)).toEqual([])
  })

  it('has a capital in the table for every state and union territory', () => {
    for (const { code } of INDIAN_SUBDIVISIONS) expect(capitalOf(code).slug).toMatch(/^[a-z-]+$/)
    expect(capitalOf('IN-HR').name).toBe('Chandigarh')
    expect(capitalOf('IN-TS').name).toBe('Hyderabad')
  })
})

describe('cityNamed', () => {
  it.each([
    ['Bangalore', 'bengaluru'],
    ['Bombay', 'mumbai'],
    ['Gurgaon', 'gurugram'],
    ['New Delhi', 'delhi'],
    ['Trivandrum', 'thiruvananthapuram'],
    ['Mysore', 'mysuru'],
    ['  PUNE ', 'pune'],
    ['Pondicherry', 'puducherry'],
  ])('resolves %j to %s', (name, slug) => {
    expect(cityNamed(name)?.slug).toBe(slug)
  })

  it.each(['Khardung La', 'Atlantis', ''])('knows nothing of %j', (name) => {
    expect(cityNamed(name)).toBeNull()
  })
})

describe('cityBySlug', () => {
  it('takes slugs only, never an alias', () => {
    expect(cityBySlug('bengaluru')?.name).toBe('Bengaluru')
    expect(cityBySlug('bangalore')).toBeNull()
    expect(cityBySlug('Bengaluru')).toBeNull()
  })
})

describe('distanceKm', () => {
  it.each([
    ['Mumbai', 'Pune', 120],
    ['Delhi', 'Gurugram', 24],
    ['Bengaluru', 'Mysuru', 127],
    ['Chennai', 'Kolkata', 1366],
  ])('puts %s and %s about %i km apart in a straight line', (a, b, km) => {
    expect(distanceKm(named(a), named(b))).toBeGreaterThan(km * 0.95)
    expect(distanceKm(named(a), named(b))).toBeLessThan(km * 1.05)
  })

  it('is zero to itself and the same both ways', () => {
    expect(distanceKm(named('Leh'), named('Leh'))).toBe(0)
    expect(distanceKm(named('Leh'), named('Kochi'))).toBe(distanceKm(named('Kochi'), named('Leh')))
  })
})

type TestRace = { name: string; dates: { start: LocalDate }; location: RaceLocation }

const race = (name: string, start: string, city: string, subdivision: Subdivision): TestRace => ({
  name,
  dates: { start: start as LocalDate },
  location: { kind: 'venue', venue: `${city} stadium`, city, subdivision, country: 'IN' },
})

describe('nearestRaces', () => {
  const races: TestRace[] = [
    race('Kolkata 10K', '2027-01-10', 'Kolkata', 'IN-WB'),
    race('Pune Half late', '2027-03-01', 'Pune', 'IN-MH'),
    race('Bombay Marathon', '2027-01-18', 'Bombay', 'IN-MH'),
    race('Pune Half early', '2027-02-01', 'pune', 'IN-MH'),
    race('Village Trail', '2027-01-05', 'Bhimashankar', 'IN-MH'),
    race('Lost Race', '2027-01-01', 'Nowhere', 'IN-XX' as Subdivision),
    { name: 'Virtual 5K', dates: { start: '2027-01-02' as LocalDate }, location: { kind: 'virtual' } },
  ]

  it('orders by kilometres from the city, then by start date, with unplaceable races last', () => {
    expect(nearestRaces(races, named('Pune')).map(({ race }) => race.name)).toEqual([
      'Pune Half early',
      'Pune Half late',
      'Bombay Marathon',
      'Village Trail',
      'Kolkata 10K',
      'Lost Race',
    ])
  })

  it('places a city missing from the table at its state capital, after an exact match at the same distance', () => {
    const fromMumbai = nearestRaces(races, named('Mumbai'))
    expect(fromMumbai.slice(0, 2).map(({ race, distance }) => [race.name, distance.kind])).toEqual([
      ['Bombay Marathon', 'city'],
      ['Village Trail', 'capital'],
    ])
    const village = fromMumbai.find(({ race }) => race.name === 'Village Trail')?.distance
    expect(village?.kind === 'capital' ? [village.capital.name, village.km] : null).toEqual(['Mumbai', 0])
  })

  it('reports distances in kilometres and leaves virtual races out', () => {
    const fromPune = nearestRaces(races, named('Pune'))
    const bombay = fromPune.find(({ race }) => race.name === 'Bombay Marathon')?.distance
    expect(bombay?.kind === 'city' ? Math.round(bombay.km / 10) * 10 : null).toBe(120)
    expect(fromPune.at(-1)?.distance).toEqual({ kind: 'unknown' })
    expect(fromPune.some(({ race }) => race.location.kind === 'virtual')).toBe(false)
  })

  it('works from any city, near or far', () => {
    expect(nearestRaces(races, named('Kolkata'))[0]?.race.name).toBe('Kolkata 10K')
    expect(nearestRaces([], named('Kolkata'))).toEqual([])
  })
})

describe('parseHomeCity', () => {
  it.each([
    [{ city: 'pune' }, { ok: true, value: { city: 'pune' } }],
    [{ city: '' }, { ok: true, value: { city: null } }],
    [{}, { ok: true, value: { city: null } }],
    [{ city: 'bangalore' }, { ok: false, error: { city: 'Choose a city from the list.' } }],
    [{ city: 'atlantis' }, { ok: false, error: { city: 'Choose a city from the list.' } }],
  ])('parses %j', (raw, result) => {
    expect(parseHomeCity(raw)).toEqual(result)
  })
})
