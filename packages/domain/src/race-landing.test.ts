import { describe, expect, it } from 'vitest'
import {
  canonicalPathOf,
  disciplineLandingPath,
  isReservedRaceSlug,
  nearestLandingPath,
  parseRaceQuery,
  racesHref,
  stateLandingPath,
  type LocalDate,
  type QueryParams,
} from './index'

const today = '2026-10-19' as LocalDate
const query = (params: QueryParams) => parseRaceQuery(params, today)

describe('canonicalPathOf', () => {
  it.each([
    ['the unfiltered calendar', {}, '/races'],
    ['a later page of it', { page: '3' }, '/races?page=3'],
    ['one state', { state: 'in-ts' }, '/races/in/telangana'],
    ['one state, page 2', { state: 'IN-AP', page: '2' }, '/races/in/andhra-pradesh?page=2'],
    ['one discipline', { discipline: 'trail' }, '/races/discipline/trail'],
    ['from equal to today', { from: '2026-10-19', discipline: 'road' }, '/races/discipline/road'],
  ] as const)('gives %s a landing page', (_name, params, path) => {
    expect(canonicalPathOf(query(params), today)).toBe(path)
  })

  it.each([
    ['state plus discipline', { state: 'IN-TS', discipline: 'trail' }],
    ['two disciplines', { discipline: 'trail,road' }],
    ['one band', { band: 'over-100k' }],
    ['text', { q: 'Hyderabad' }],
    ['a date window', { from: '2026-12-01' }],
    ['registration open', { open: '1' }],
    ['virtual included', { virtual: '1' }],
    ['state plus virtual', { state: 'IN-TS', virtual: '1' }],
  ] as const)('marks %s as noindex', (_name, params) => {
    expect(canonicalPathOf(query(params), today)).toBeNull()
  })
})

describe('nearestLandingPath', () => {
  it.each([
    [{ state: 'IN-TS', discipline: 'trail', q: 'lake' }, '/races/in/telangana'],
    [{ discipline: 'trail', band: 'over-100k' }, '/races/discipline/trail'],
    [{ discipline: 'trail,road' }, '/races'],
    [{ open: '1' }, '/races'],
    [{ state: 'IN-TS', page: '2' }, '/races/in/telangana'],
  ] as const)('points %j at %s', (params, path) => {
    expect(nearestLandingPath(query(params))).toBe(path)
  })
})

describe('racesHref', () => {
  it('links single-facet views to their landing page and everything else to the query string', () => {
    expect(racesHref(query({ state: 'IN-TS' }), today)).toBe('/races/in/telangana')
    expect(racesHref(query({ state: 'IN-TS', open: '1' }), today)).toBe('/races?state=IN-TS&open=1')
    expect(racesHref(query({ state: 'IN-TS', page: '2' }), today)).toBe('/races/in/telangana?page=2')
  })
})

describe('isReservedRaceSlug', () => {
  const firstSegmentAfterRaces = (path: string) => path.split('/')[2] ?? ''

  it.each([stateLandingPath('IN-TS'), disciplineLandingPath('trail')])('reserves the segment that %s starts with', (path) => {
    expect(isReservedRaceSlug(firstSegmentAfterRaces(path))).toBe(true)
  })

  it.each(['hyderabad-10k-2026', 'india', 'disciplined-runners-5k'])('leaves %s free', (slug) => {
    expect(isReservedRaceSlug(slug)).toBe(false)
  })
})
