import { describe, expect, it } from 'vitest'
import { parseRaceSubmission } from './index'

const valid = {
  name: '  Hyderabad Trail Half  ',
  discipline: 'trail',
  start: '2026-12-06',
  dayCount: '2',
  timeZone: 'Asia/Kolkata',
  venue: 'Gandipet Lake',
  city: 'Hyderabad',
  state: 'in-ts',
  distances: ['21097', '10000,5000'],
  officialUrl: 'https://hyderabadtrail.example.in/2026',
  registrationUrl: 'https://tickets.example.com/hyd-trail?ref=erc',
  registrationClosesOn: '2026-11-30',
  summary: 'Rolling trail loops around the lake.',
  submitterName: 'Asha Rao',
  submitterEmail: 'asha@example.com',
}

const errorKeys = (input: Record<string, unknown>) => {
  const result = parseRaceSubmission(input)
  return result.ok ? [] : Object.keys(result.error).sort()
}

describe('parseRaceSubmission', () => {
  it('builds a submission from a complete form', () => {
    expect(parseRaceSubmission(valid)).toEqual({
      ok: true,
      value: {
        name: 'Hyderabad Trail Half',
        discipline: 'trail',
        dates: { start: '2026-12-06', dayCount: 2 },
        timeZone: 'Asia/Kolkata',
        location: { kind: 'venue', venue: 'Gandipet Lake', city: 'Hyderabad', subdivision: 'IN-TS', country: 'IN' },
        distances: [{ metres: 21_097 }, { metres: 10_000 }, { metres: 5_000 }],
        officialUrl: 'https://hyderabadtrail.example.in/2026',
        registration: { url: 'https://tickets.example.com/hyd-trail?ref=erc', closesOn: '2026-11-30' },
        summary: 'Rolling trail loops around the lake.',
        submitter: { name: 'Asha Rao', email: 'asha@example.com' },
      },
    })
  })

  it('fills the defaults for optional fields', () => {
    const { dayCount, timeZone, registrationUrl, registrationClosesOn, summary, ...required } = valid
    const result = parseRaceSubmission(required)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.dates.dayCount).toBe(1)
    expect(result.value.timeZone).toBe('Asia/Kolkata')
    expect(result.value.registration).toEqual({ url: 'https://hyderabadtrail.example.in/2026', closesOn: null })
    expect(result.value.summary).toBe('')
  })

  it.each(['1', 'on'])('builds a virtual race with virtual=%j and no place fields', (flag) => {
    const { venue, city, state, ...rest } = valid
    const result = parseRaceSubmission({ ...rest, virtual: flag })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.location).toEqual({ kind: 'virtual' })
  })

  it('takes the first value when a single-valued field arrives as an array', () => {
    const result = parseRaceSubmission({ ...valid, name: ['Vizag Beach Run', 'ignored'] })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.name).toBe('Vizag Beach Run')
  })

  it('keeps a race abroad in its own time zone', () => {
    const result = parseRaceSubmission({ ...valid, timeZone: 'Europe/Paris' })
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    expect(result.value.timeZone).toBe('Europe/Paris')
  })

  it('reports every missing required field, keyed by field name', () => {
    expect(errorKeys({})).toEqual(['city', 'discipline', 'distances', 'name', 'officialUrl', 'start', 'state', 'submitterEmail', 'submitterName', 'venue'])
  })

  it('treats non-string values as missing', () => {
    expect(errorKeys({ ...valid, name: 42, start: new Date(), distances: [21097] })).toEqual(['distances', 'name', 'start'])
  })

  it.each([
    ['name', 'Hi'],
    ['name', 'x'.repeat(121)],
    ['discipline', 'ultra'],
    ['start', '2026-02-30'],
    ['start', '06/12/2026'],
    ['dayCount', '0'],
    ['dayCount', '31'],
    ['dayCount', '1.5'],
    ['timeZone', 'Mars/Olympus'],
    ['state', 'Telangana'],
    ['venue', ''],
    ['city', ''],
    ['distances', ''],
    ['distances', '0'],
    ['distances', '-5000'],
    ['distances', '21.1'],
    ['distances', '21k'],
    ['distances', ['21097', 'half']],
    ['officialUrl', 'http://insecure.example.com'],
    ['officialUrl', 'https://'],
    ['officialUrl', 'https://localhost/race'],
    ['officialUrl', 'https://user@evil.example.com'],
    ['officialUrl', 'javascript:alert(1)'],
    ['officialUrl', 'https://example.com/has space'],
    ['registrationUrl', 'ftp://example.com/register'],
    ['registrationClosesOn', '2026-11-31'],
    ['summary', 'x'.repeat(1001)],
    ['submitterName', ''],
    ['submitterEmail', 'asha@'],
    ['submitterEmail', 'asha example.com'],
    ['submitterEmail', 'asha@localhost'],
    // The CMS email field refuses these, so a submission carrying one would fail on save.
    ['submitterEmail', 'a..b@example.com'],
    ['submitterEmail', 'me@exämple.com'],
  ] as const)('rejects %s = %j with an error on that field only', (field, value) => {
    expect(errorKeys({ ...valid, [field]: value })).toEqual([field])
  })

  it.each([
    ['name', 'Run'],
    ['name', 'x'.repeat(120)],
    ['dayCount', '1'],
    ['dayCount', '30'],
    ['summary', 'x'.repeat(1000)],
    ['submitterName', 'Al'],
    ['officialUrl', 'https://sub.example.co.in:8443/path?x=1#y'],
  ] as const)('accepts %s = %j at the edge of its range', (field, value) => {
    expect(errorKeys({ ...valid, [field]: value })).toEqual([])
  })
})
