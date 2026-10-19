import { describe, expect, it } from 'vitest'
import {
  googleCalendarUrl,
  toIcs,
  type HttpsUrl,
  type Id,
  type Instant,
  type LocalDate,
  type Metres,
  type PublicRace,
  type Slug,
  type StaffId,
  type Subdivision,
} from './index'

const race = (overrides: Partial<PublicRace> = {}): PublicRace => ({
  id: 42 as Id<'races'>,
  slug: 'hyderabad-trail-half' as Slug,
  name: 'Hyderabad Trail Half',
  discipline: 'trail',
  dates: { start: '2026-12-06' as LocalDate, dayCount: 1 },
  timeZone: 'Asia/Kolkata',
  location: { kind: 'venue', venue: 'Gandipet Lake', city: 'Hyderabad', subdivision: 'IN-TG' as Subdivision, country: 'IN' },
  distances: [{ metres: 21_097 as Metres, category: 'half', band: 'half-to-marathon' }],
  officialUrl: 'https://hyderabadtrail.example.in/2026' as HttpsUrl,
  registration: { url: 'https://tickets.example.com/hyd' as HttpsUrl, closesOn: null },
  status: { kind: 'scheduled' },
  source: { kind: 'runner-submission' },
  lastVerifiedOn: '2026-10-01' as LocalDate,
  summary: 'Rolling loops around the lake.',
  moderation: { state: 'approved', by: 1 as StaffId, at: '2026-10-01T00:00:00.000Z' as Instant },
  ...overrides,
})

const lines = (ics: string) => ics.split('\r\n')
const unfold = (ics: string) => ics.replace(/\r\n /g, '')
const utf8Length = (s: string) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, '.').length

describe('toIcs', () => {
  it('writes one all-day VEVENT with CRLF line endings', () => {
    expect(toIcs(race())).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//ERC//Race calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:race-42@erc',
        'DTSTAMP:20261001T000000Z',
        'DTSTART;VALUE=DATE:20261206',
        'DTEND;VALUE=DATE:20261207',
        'SUMMARY:Hyderabad Trail Half',
        'DESCRIPTION:Rolling loops around the lake.',
        'LOCATION:Gandipet Lake\\, Hyderabad',
        'URL:https://hyderabadtrail.example.in/2026',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    )
  })

  it('is byte-identical across calls, so a re-import updates the same event', () => {
    expect(toIcs(race())).toBe(toIcs(race()))
  })

  it('ends a multi-day event the day after its last day, across a year boundary', () => {
    const ics = toIcs(race({ dates: { start: '2026-12-30' as LocalDate, dayCount: 3 } }))
    expect(lines(ics)).toContain('DTSTART;VALUE=DATE:20261230')
    expect(lines(ics)).toContain('DTEND;VALUE=DATE:20270102')
  })

  it('marks a cancelled race as cancelled', () => {
    expect(lines(toIcs(race({ status: { kind: 'cancelled' } })))).toContain('STATUS:CANCELLED')
  })

  it.each([{ kind: 'scheduled' }, { kind: 'postponed', newStart: null }] as const)('writes no STATUS for a %o race', (status) => {
    expect(toIcs(race({ status })).includes('STATUS:')).toBe(false)
  })

  it('locates a virtual race as Virtual', () => {
    expect(lines(toIcs(race({ location: { kind: 'virtual' } })))).toContain('LOCATION:Virtual')
  })

  it('omits DESCRIPTION when there is no summary', () => {
    expect(toIcs(race({ summary: '' })).includes('DESCRIPTION')).toBe(false)
  })

  it('escapes backslash, semicolon, comma, and newlines in text', () => {
    const ics = toIcs(race({ name: 'Run; walk, repeat', summary: 'C:\\trails\nLine two\r\nLine three' }))
    expect(lines(ics)).toContain('SUMMARY:Run\\; walk\\, repeat')
    expect(lines(ics)).toContain('DESCRIPTION:C:\\\\trails\\nLine two\\nLine three')
  })

  it.each([
    ['ASCII', 'Hyderabad '.repeat(30)],
    ['Telugu, three octets a character', 'హైదరాబాద్ ట్రైల్ హాఫ్ మారథాన్ '.repeat(6)],
    ['emoji, four octets a character', `${'x'.repeat(73)}${'🏃'.repeat(40)}`],
  ])('folds %s text into lines of at most 75 octets without splitting a character', (_name, summary) => {
    const ics = toIcs(race({ summary }))
    for (const line of lines(ics)) expect(utf8Length(line)).toBeLessThanOrEqual(75)
    expect(lines(ics).filter((line) => line.startsWith(' ')).length).toBeGreaterThan(0)
    expect(lines(unfold(ics))).toContain(`DESCRIPTION:${summary}`)
  })

  it('does not fold a line of exactly 75 octets', () => {
    const summary = 'x'.repeat(75 - 'DESCRIPTION:'.length)
    expect(lines(toIcs(race({ summary })))).toContain(`DESCRIPTION:${summary}`)
  })

  it('has no bare CR or LF inside any line', () => {
    const ics = toIcs(race({ summary: 'one\ntwo\rthree' }))
    for (const line of lines(ics)) expect(/[\r\n]/.test(line)).toBe(false)
  })
})

describe('googleCalendarUrl', () => {
  it('builds the TEMPLATE link with the same all-day dates as the ICS', () => {
    expect(googleCalendarUrl(race({ dates: { start: '2026-12-30' as LocalDate, dayCount: 3 } }))).toBe(
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Hyderabad%20Trail%20Half&dates=20261230%2F20270102' +
        '&details=Rolling%20loops%20around%20the%20lake.%0A%0Ahttps%3A%2F%2Fhyderabadtrail.example.in%2F2026' +
        '&location=Gandipet%20Lake%2C%20Hyderabad',
    )
  })

  it('encodes characters that would otherwise split the query', () => {
    const url = googleCalendarUrl(race({ name: 'Run & Ride #1', summary: '', location: { kind: 'virtual' } }))
    expect(url).toContain('&text=Run%20%26%20Ride%20%231&')
    expect(url).toContain('&details=https%3A%2F%2Fhyderabadtrail.example.in%2F2026&')
    expect(url.endsWith('&location=Virtual')).toBe(true)
  })
})
