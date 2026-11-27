import { firstOf, type FieldErrors } from './form-fields'
import type { RawInput } from './members'
import { err, ok, type Brand, type LocalDate, type Result } from './primitives'
import type { Race } from './races'
import type { Subdivision } from './subdivisions'

/** A slug in `CITIES`. Only `cityBySlug` and `cityNamed` hand one out, so a stored or linked city is always known. */
export type CitySlug = Brand<string, 'CitySlug'>

export type LatLng = { lat: number; lng: number }

export type City = LatLng & { slug: CitySlug; name: string; subdivision: Subdivision; aliases: readonly string[] }

const city = (slug: string, name: string, subdivision: Subdivision, lat: number, lng: number, ...aliases: string[]): City => ({
  slug: slug as CitySlug,
  name,
  subdivision,
  lat,
  lng,
  aliases,
})

/**
 * Indian cities that host races, with every state and union territory capital, to two decimal places (about 1 km).
 * A slug is a public URL and a stored member preference, so it stays fixed once published even if a name changes;
 * old and alternative names go in the aliases.
 */
export const CITIES: readonly City[] = [
  city('port-blair', 'Port Blair', 'IN-AN', 11.62, 92.73),
  city('amaravati', 'Amaravati', 'IN-AP', 16.51, 80.52),
  city('visakhapatnam', 'Visakhapatnam', 'IN-AP', 17.69, 83.22, 'vizag'),
  city('vijayawada', 'Vijayawada', 'IN-AP', 16.51, 80.65),
  city('tirupati', 'Tirupati', 'IN-AP', 13.63, 79.42),
  city('guntur', 'Guntur', 'IN-AP', 16.31, 80.44),
  city('araku-valley', 'Araku Valley', 'IN-AP', 18.33, 82.87, 'araku'),
  city('itanagar', 'Itanagar', 'IN-AR', 27.08, 93.61),
  city('guwahati', 'Guwahati', 'IN-AS', 26.14, 91.74, 'dispur'),
  city('patna', 'Patna', 'IN-BR', 25.59, 85.14),
  city('chandigarh', 'Chandigarh', 'IN-CH', 30.73, 76.78),
  city('raipur', 'Raipur', 'IN-CG', 21.25, 81.63),
  city('daman', 'Daman', 'IN-DH', 20.4, 72.83),
  city('delhi', 'Delhi', 'IN-DL', 28.61, 77.21, 'new-delhi'),
  city('panaji', 'Panaji', 'IN-GA', 15.5, 73.83, 'panjim', 'goa'),
  city('margao', 'Margao', 'IN-GA', 15.28, 73.96, 'madgaon'),
  city('gandhinagar', 'Gandhinagar', 'IN-GJ', 23.22, 72.65),
  city('ahmedabad', 'Ahmedabad', 'IN-GJ', 23.02, 72.57),
  city('vadodara', 'Vadodara', 'IN-GJ', 22.31, 73.18, 'baroda'),
  city('surat', 'Surat', 'IN-GJ', 21.17, 72.83),
  city('gurugram', 'Gurugram', 'IN-HR', 28.46, 77.03, 'gurgaon'),
  city('faridabad', 'Faridabad', 'IN-HR', 28.41, 77.32),
  city('shimla', 'Shimla', 'IN-HP', 31.1, 77.17, 'simla'),
  city('manali', 'Manali', 'IN-HP', 32.24, 77.19),
  city('dharamshala', 'Dharamshala', 'IN-HP', 32.22, 76.32, 'dharamsala'),
  city('srinagar', 'Srinagar', 'IN-JK', 34.08, 74.8),
  city('jammu', 'Jammu', 'IN-JK', 32.73, 74.86),
  city('ranchi', 'Ranchi', 'IN-JH', 23.34, 85.31),
  city('jamshedpur', 'Jamshedpur', 'IN-JH', 22.8, 86.2),
  city('bengaluru', 'Bengaluru', 'IN-KA', 12.97, 77.59, 'bangalore'),
  city('mysuru', 'Mysuru', 'IN-KA', 12.3, 76.64, 'mysore'),
  city('mangaluru', 'Mangaluru', 'IN-KA', 12.91, 74.86, 'mangalore'),
  city('coorg', 'Coorg', 'IN-KA', 12.42, 75.74, 'kodagu', 'madikeri'),
  city('chikmagalur', 'Chikmagalur', 'IN-KA', 13.32, 75.77, 'chikkamagaluru'),
  city('hampi', 'Hampi', 'IN-KA', 15.34, 76.46),
  city('thiruvananthapuram', 'Thiruvananthapuram', 'IN-KL', 8.52, 76.94, 'trivandrum'),
  city('kochi', 'Kochi', 'IN-KL', 9.93, 76.27, 'cochin', 'ernakulam'),
  city('munnar', 'Munnar', 'IN-KL', 10.09, 77.06),
  city('wayanad', 'Wayanad', 'IN-KL', 11.61, 76.08, 'kalpetta'),
  city('leh', 'Leh', 'IN-LA', 34.15, 77.58),
  city('kavaratti', 'Kavaratti', 'IN-LD', 10.57, 72.64),
  city('bhopal', 'Bhopal', 'IN-MP', 23.26, 77.41),
  city('indore', 'Indore', 'IN-MP', 22.72, 75.86),
  city('mumbai', 'Mumbai', 'IN-MH', 19.08, 72.88, 'bombay'),
  city('thane', 'Thane', 'IN-MH', 19.22, 72.98),
  city('pune', 'Pune', 'IN-MH', 18.52, 73.86, 'poona'),
  city('nagpur', 'Nagpur', 'IN-MH', 21.15, 79.09),
  city('nashik', 'Nashik', 'IN-MH', 20.0, 73.79, 'nasik'),
  city('lonavala', 'Lonavala', 'IN-MH', 18.75, 73.41, 'lonavla'),
  city('satara', 'Satara', 'IN-MH', 17.68, 74.02),
  city('chhatrapati-sambhajinagar', 'Chhatrapati Sambhajinagar', 'IN-MH', 19.88, 75.34, 'aurangabad'),
  city('imphal', 'Imphal', 'IN-MN', 24.82, 93.94),
  city('shillong', 'Shillong', 'IN-ML', 25.58, 91.89),
  city('cherrapunji', 'Cherrapunji', 'IN-ML', 25.3, 91.7, 'sohra'),
  city('aizawl', 'Aizawl', 'IN-MZ', 23.73, 92.72),
  city('kohima', 'Kohima', 'IN-NL', 25.67, 94.11),
  city('bhubaneswar', 'Bhubaneswar', 'IN-OD', 20.3, 85.82),
  city('puri', 'Puri', 'IN-OD', 19.81, 85.83),
  city('puducherry', 'Puducherry', 'IN-PY', 11.94, 79.81, 'pondicherry', 'pondy'),
  city('amritsar', 'Amritsar', 'IN-PB', 31.63, 74.87),
  city('ludhiana', 'Ludhiana', 'IN-PB', 30.9, 75.86),
  city('jaipur', 'Jaipur', 'IN-RJ', 26.91, 75.79),
  city('udaipur', 'Udaipur', 'IN-RJ', 24.59, 73.71),
  city('jodhpur', 'Jodhpur', 'IN-RJ', 26.24, 73.02),
  city('jaisalmer', 'Jaisalmer', 'IN-RJ', 26.92, 70.91),
  city('gangtok', 'Gangtok', 'IN-SK', 27.33, 88.61),
  city('chennai', 'Chennai', 'IN-TN', 13.08, 80.27, 'madras'),
  city('coimbatore', 'Coimbatore', 'IN-TN', 11.02, 76.96),
  city('madurai', 'Madurai', 'IN-TN', 9.93, 78.12),
  city('tiruchirappalli', 'Tiruchirappalli', 'IN-TN', 10.79, 78.7, 'trichy'),
  city('ooty', 'Ooty', 'IN-TN', 11.41, 76.7, 'udhagamandalam'),
  city('kodaikanal', 'Kodaikanal', 'IN-TN', 10.24, 77.49),
  city('hyderabad', 'Hyderabad', 'IN-TS', 17.39, 78.49),
  city('secunderabad', 'Secunderabad', 'IN-TS', 17.44, 78.5),
  city('warangal', 'Warangal', 'IN-TS', 17.97, 79.59),
  city('karimnagar', 'Karimnagar', 'IN-TS', 18.44, 79.13),
  city('nizamabad', 'Nizamabad', 'IN-TS', 18.67, 78.09),
  city('agartala', 'Agartala', 'IN-TR', 23.83, 91.29),
  city('lucknow', 'Lucknow', 'IN-UP', 26.85, 80.95),
  city('varanasi', 'Varanasi', 'IN-UP', 25.32, 82.97, 'banaras', 'benares'),
  city('noida', 'Noida', 'IN-UP', 28.54, 77.39),
  city('ghaziabad', 'Ghaziabad', 'IN-UP', 28.67, 77.45),
  city('agra', 'Agra', 'IN-UP', 27.18, 78.01),
  city('dehradun', 'Dehradun', 'IN-UK', 30.32, 78.03),
  city('rishikesh', 'Rishikesh', 'IN-UK', 30.09, 78.27),
  city('mussoorie', 'Mussoorie', 'IN-UK', 30.46, 78.07),
  city('nainital', 'Nainital', 'IN-UK', 29.38, 79.46),
  city('kolkata', 'Kolkata', 'IN-WB', 22.57, 88.36, 'calcutta'),
  city('darjeeling', 'Darjeeling', 'IN-WB', 27.04, 88.26),
  city('siliguri', 'Siliguri', 'IN-WB', 26.73, 88.4),
]

/**
 * Where a race in a city missing from `CITIES` is placed: its state's capital. Haryana and Punjab both fall back to
 * Chandigarh, which is its own union territory, so this maps to a slug rather than marking a city as a capital.
 */
const CAPITALS: Readonly<Record<Subdivision, string>> = {
  'IN-AN': 'port-blair',
  'IN-AP': 'amaravati',
  'IN-AR': 'itanagar',
  'IN-AS': 'guwahati',
  'IN-BR': 'patna',
  'IN-CH': 'chandigarh',
  'IN-CG': 'raipur',
  'IN-DH': 'daman',
  'IN-DL': 'delhi',
  'IN-GA': 'panaji',
  'IN-GJ': 'gandhinagar',
  'IN-HR': 'chandigarh',
  'IN-HP': 'shimla',
  'IN-JK': 'srinagar',
  'IN-JH': 'ranchi',
  'IN-KA': 'bengaluru',
  'IN-KL': 'thiruvananthapuram',
  'IN-LA': 'leh',
  'IN-LD': 'kavaratti',
  'IN-MP': 'bhopal',
  'IN-MH': 'mumbai',
  'IN-MN': 'imphal',
  'IN-ML': 'shillong',
  'IN-MZ': 'aizawl',
  'IN-NL': 'kohima',
  'IN-OD': 'bhubaneswar',
  'IN-PY': 'puducherry',
  'IN-PB': 'chandigarh',
  'IN-RJ': 'jaipur',
  'IN-SK': 'gangtok',
  'IN-TN': 'chennai',
  'IN-TS': 'hyderabad',
  'IN-TR': 'agartala',
  'IN-UP': 'lucknow',
  'IN-UK': 'dehradun',
  'IN-WB': 'kolkata',
}

const BY_SLUG = new Map<string, City>(CITIES.map((entry) => [entry.slug, entry]))
const BY_NAME = new Map<string, City>(CITIES.flatMap((entry) => [entry.slug, ...entry.aliases].map((key) => [key, entry] as const)))

const keyOf = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Exact slugs only, the form a URL or a stored preference takes. */
export const cityBySlug = (slug: string): City | null => BY_SLUG.get(slug) ?? null

/** A city as people write it: any case, spacing or accents, and old names such as Bombay or Gurgaon. */
export const cityNamed = (name: string): City | null => BY_NAME.get(keyOf(name)) ?? null

export const capitalOf = (subdivision: Subdivision): City => {
  const capital = BY_SLUG.get(CAPITALS[subdivision])
  if (!capital) throw new Error(`No capital in CITIES for ${subdivision}`)
  return capital
}

const EARTH_RADIUS_KM = 6371.0088
const radians = (degrees: number) => (degrees * Math.PI) / 180

/** Great-circle distance by the haversine formula. Roads are longer; pages say "about". */
export const distanceKm = (a: LatLng, b: LatLng): number => {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * How far a race is from the runner's city. `capital` means the race's city is not in `CITIES` and its state's
 * capital stood in; `unknown` means not even that worked, which only a race with no state can reach.
 */
export type RaceDistance = { kind: 'city'; km: number; city: City } | { kind: 'capital'; km: number; capital: City } | { kind: 'unknown' }

export type NearRace<R> = { race: R; distance: RaceDistance }

type Placeable = { dates: { start: LocalDate }; location: Race['location'] }

const distanceOf = (location: Extract<Race['location'], { kind: 'venue' }>, origin: City): RaceDistance => {
  const exact = cityNamed(location.city)
  if (exact) return { kind: 'city', km: distanceKm(origin, exact), city: exact }
  const capital = BY_SLUG.get(CAPITALS[location.subdivision] ?? '')
  return capital ? { kind: 'capital', km: distanceKm(origin, capital), capital } : { kind: 'unknown' }
}

const RANK: Readonly<Record<RaceDistance['kind'], number>> = { city: 0, capital: 1, unknown: 2 }

const compare = <R extends Placeable>(a: NearRace<R>, b: NearRace<R>) => {
  const aKm = a.distance.kind === 'unknown' ? Infinity : a.distance.km
  const bKm = b.distance.kind === 'unknown' ? Infinity : b.distance.km
  return aKm - bKm || RANK[a.distance.kind] - RANK[b.distance.kind] || a.race.dates.start.localeCompare(b.race.dates.start)
}

/**
 * Venue races nearest `origin` first, by kilometres and then start date. A race placed by its state's capital sorts
 * after exact matches at the same distance, and races that cannot be placed come last. Virtual races are left out:
 * they are nowhere, so they are not near anyone.
 */
export const nearestRaces = <R extends Placeable>(races: readonly R[], origin: City): NearRace<R>[] =>
  races
    .flatMap((race) => (race.location.kind === 'venue' ? [{ race, distance: distanceOf(race.location, origin) }] : []))
    .sort(compare)

/** A member's home city from the `/me` form or the API: a slug from `CITIES`, or empty to clear it. */
export const parseHomeCity = (raw: RawInput): Result<{ city: CitySlug | null }, FieldErrors> => {
  const value = firstOf(raw.city)
  if (value === '') return ok({ city: null })
  const found = cityBySlug(value)
  return found ? ok({ city: found.slug }) : err({ city: 'Choose a city from the list.' })
}
