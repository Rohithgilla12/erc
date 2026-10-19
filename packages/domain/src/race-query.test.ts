import { describe, expect, it } from 'vitest'
import {
  isVerificationStale,
  parseRaceQuery,
  serialiseRaceQuery,
  tapChip,
  type LocalDate,
  type QueryParams,
  type RaceQuery,
  type Subdivision,
} from './index'

const today = '2026-10-19' as LocalDate
const d = (s: string) => s as LocalDate

const defaults: RaceQuery = {
  from: today,
  to: null,
  disciplines: [],
  bands: [],
  subdivision: null,
  includeVirtual: false,
  registrationOpen: false,
  text: null,
  page: 1,
}

const splitQuery = (qs: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  if (qs === '') return out
  for (const pair of qs.split('&')) {
    const eq = pair.indexOf('=')
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq))
    const value = eq < 0 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))
    out[key] = [...(out[key] ?? []), value]
  }
  return out
}

describe('isVerificationStale', () => {
  it.each([
    ['2026-10-19', '2026-10-19', false],
    ['2026-07-21', '2026-10-19', false],
    ['2026-07-20', '2026-10-19', true],
    ['2028-01-01', '2028-03-31', false],
    ['2028-01-01', '2028-04-01', true],
    ['2026-11-15', '2027-02-13', false],
    ['2026-11-15', '2027-02-14', true],
  ] as const)('verified %s, today %s: stale is %s', (lastVerifiedOn, on, stale) => {
    expect(isVerificationStale({ lastVerifiedOn: d(lastVerifiedOn) }, d(on))).toBe(stale)
  })
})

describe('parseRaceQuery', () => {
  it('gives the defaults for no params', () => {
    expect(parseRaceQuery({}, today)).toEqual(defaults)
  })

  it('reads every filter', () => {
    expect(
      parseRaceQuery(
        {
          from: '2026-11-01',
          to: '2026-12-31',
          discipline: 'trail',
          band: ['under-10k', 'over-100k'],
          state: 'IN-TS',
          virtual: '1',
          open: '1',
          q: 'Hyderabad half',
          page: '3',
        },
        today,
      ),
    ).toEqual({
      from: '2026-11-01',
      to: '2026-12-31',
      disciplines: ['trail'],
      bands: ['under-10k', 'over-100k'],
      subdivision: 'IN-TS',
      includeVirtual: true,
      registrationOpen: true,
      text: 'Hyderabad half',
      page: 3,
    })
  })

  it('accepts repeated and comma-separated lists, any case, dropping unknown values and duplicates', () => {
    const query = parseRaceQuery({ discipline: ['TRAIL, road ,ultra', 'trail', ''], band: 'bogus,half-to-marathon' }, today)
    expect(query.disciplines).toEqual(['road', 'trail'])
    expect(query.bands).toEqual(['half-to-marathon'])
  })

  it('drops invalid dates instead of throwing', () => {
    expect(parseRaceQuery({ from: '2026-02-30', to: 'next week' }, today)).toEqual(defaults)
  })

  it('takes the first value when a scalar param repeats', () => {
    const query = parseRaceQuery({ from: ['2026-11-01', '2026-12-01'], page: ['4', '9'] }, today)
    expect(query.from).toBe('2026-11-01')
    expect(query.page).toBe(4)
  })

  it.each([
    ['in-ts', 'IN-TS'],
    [' IN-AP ', 'IN-AP'],
    ['US-CA', null],
    ['IN-TG', null],
    ['Telangana', null],
    ['IN', null],
    ['IN-TSXX', null],
  ] as const)('normalises state %j to %j', (state, subdivision) => {
    expect(parseRaceQuery({ state }, today).subdivision).toBe(subdivision)
  })

  it.each(['true', 'yes', '0', ''])('treats virtual=%j and open=%j as off', (flag) => {
    const query = parseRaceQuery({ virtual: flag, open: flag }, today)
    expect([query.includeVirtual, query.registrationOpen]).toEqual([false, false])
  })

  it.each([
    ['1', 1],
    ['1000', 1000],
    ['1001', 1],
    ['0', 1],
    ['-3', 1],
    ['2.5', 1],
    ['abc', 1],
    ['', 1],
  ] as const)('reads page %j as %i', (page, expected) => {
    expect(parseRaceQuery({ page }, today).page).toBe(expected)
  })

  it('trims text, collapses inner whitespace, and treats blank as no text', () => {
    expect(parseRaceQuery({ q: '  Hyderabad \t  Half \n' }, today).text).toBe('Hyderabad Half')
    expect(parseRaceQuery({ q: '   ' }, today).text).toBeNull()
  })

  it('clips text to 100 characters, counting an emoji as one', () => {
    expect(parseRaceQuery({ q: 'a'.repeat(150) }, today).text).toBe('a'.repeat(100))
    expect(parseRaceQuery({ q: '🏃'.repeat(120) }, today).text).toBe('🏃'.repeat(100))
  })

  it('strips unpaired surrogates so the text can be serialised', () => {
    const query = parseRaceQuery({ q: 'trail \uD800run' }, today)
    expect(query.text).toBe('trail run')
    expect(serialiseRaceQuery(query, today)).toBe('q=trail%20run')
  })
})

describe('serialiseRaceQuery', () => {
  it('serialises the default query as an empty string', () => {
    expect(serialiseRaceQuery(defaults, today)).toBe('')
  })

  it('omits from when it is today, and keeps it otherwise', () => {
    expect(serialiseRaceQuery({ ...defaults, from: today }, today)).toBe('')
    expect(serialiseRaceQuery({ ...defaults, from: d('2026-10-18') }, today)).toBe('from=2026-10-18')
  })

  it('writes every key in a fixed order', () => {
    const query: RaceQuery = {
      page: 3,
      text: 'mud, rain & 50% off',
      registrationOpen: true,
      includeVirtual: true,
      subdivision: 'IN-TS' as Subdivision,
      bands: ['over-100k', 'under-10k'],
      disciplines: ['trail', 'road'],
      to: d('2026-12-31'),
      from: d('2026-11-01'),
    }
    expect(serialiseRaceQuery(query, today)).toBe(
      'from=2026-11-01&to=2026-12-31&discipline=road,trail&band=under-10k,over-100k&state=IN-TS&virtual=1&open=1&q=mud%2C%20rain%20%26%2050%25%20off&page=3',
    )
  })

  it('gives byte-identical strings for queries that differ only in list order and duplicates', () => {
    const a = serialiseRaceQuery({ ...defaults, disciplines: ['trail', 'road', 'trail'], bands: ['over-100k', 'under-10k'] }, today)
    const b = serialiseRaceQuery({ ...defaults, disciplines: ['road', 'trail'], bands: ['under-10k', 'over-100k', 'under-10k'] }, today)
    expect(a).toBe('discipline=road,trail&band=under-10k,over-100k')
    expect(b).toBe(a)
  })
})

describe('parse and serialise round trip', () => {
  const messy: [string, QueryParams][] = [
    ['empty', {}],
    ['date window', { from: '2026-12-01', to: '2027-01-31' }],
    ['from equal to today', { from: '2026-10-19' }],
    ['past from', { from: '2025-01-01' }],
    ['invalid dates', { from: '2026-02-30', to: 'tomorrow' }],
    ['duplicated lists', { discipline: ['trail', 'road', 'trail'], band: 'over-100k,under-10k,over-100k' }],
    ['mixed case and unknown values', { discipline: 'TRAIL, Road ,running', band: ['bogus', ''] }],
    ['lower-case state and flags', { state: 'in-ts', virtual: '1', open: '1' }],
    ['invalid state and flags', { state: 'Telangana', virtual: 'yes', open: 'true' }],
    ['spaced text', { q: '   Hyderabad   Half  ' }],
    ['long text', { q: 'a '.repeat(80) }],
    ['emoji at the clip boundary', { q: `${'x'.repeat(99)}🏃🏃` }],
    ['reserved characters in text', { q: 'mud & rain, 50% off? #1 /trail+ultra=yes' }],
    ['unpaired surrogate', { q: '\uDC00 night run' }],
    ['repeated scalars', { from: ['2026-11-01', '2026-12-01'], page: ['3', '4'] }],
    ['page out of range', { page: '1001' }],
    ['unknown params', { sort: 'date', utm_source: 'whatsapp', discipline: undefined }],
    [
      'everything at once',
      { from: '2026-11-01', to: '2026-12-31', discipline: 'community,virtual', band: 'marathon-to-60k', state: 'IN-AP', virtual: '1', open: '1', q: 'Vizag', page: '12' },
    ],
  ]

  it.each(messy)('%s survives parse, serialise, parse', (_name, params) => {
    const query = parseRaceQuery(params, today)
    const reparsed = parseRaceQuery(splitQuery(serialiseRaceQuery(query, today)), today)
    expect(reparsed).toEqual(query)
  })

  it.each(messy)('%s serialises to the same string after a round trip', (_name, params) => {
    const once = serialiseRaceQuery(parseRaceQuery(params, today), today)
    const twice = serialiseRaceQuery(parseRaceQuery(splitQuery(once), today), today)
    expect(twice).toBe(once)
  })
})

describe('tapChip', () => {
  const on = (params: QueryParams) => ({ ...parseRaceQuery(params, today), page: 4 })

  it('adds an unselected discipline to the selected ones, in table order', () => {
    expect(tapChip(on({ discipline: 'trail' }), { family: 'discipline', value: 'road' })).toEqual({ ...defaults, disciplines: ['road', 'trail'] })
  })

  it('removes a selected discipline, which clears the filter when it was the only one', () => {
    expect(tapChip(on({ discipline: 'road' }), { family: 'discipline', value: 'road' })).toEqual(defaults)
  })

  it('toggles bands the same way', () => {
    expect(tapChip(on({ band: 'over-100k' }), { family: 'band', value: 'under-10k' }).bands).toEqual(['under-10k', 'over-100k'])
    expect(tapChip(on({ band: 'over-100k,under-10k' }), { family: 'band', value: 'over-100k' }).bands).toEqual(['under-10k'])
  })

  it('replaces the selected state with another, and clears it when tapped again', () => {
    expect(tapChip(on({ state: 'IN-TS' }), { family: 'subdivision', value: 'IN-AP' as Subdivision }).subdivision).toBe('IN-AP')
    expect(tapChip(on({ state: 'IN-TS' }), { family: 'subdivision', value: 'IN-TS' as Subdivision }).subdivision).toBeNull()
  })

  it('keeps every other filter and goes back to page 1', () => {
    const query = on({ q: 'ultra', open: '1', virtual: '1', state: 'IN-TS', from: '2026-11-01' })
    expect(tapChip(query, { family: 'discipline', value: 'trail' })).toEqual({ ...query, page: 1, disciplines: ['trail'] })
  })
})
