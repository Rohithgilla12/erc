import { describe, expect, it } from 'vitest'
import { clubDateOf, inPeriod, monthOf, periodOf, weekOf, type LocalDate } from './index'

const date = (value: string) => value as LocalDate

describe('clubDateOf', () => {
  it('turns Sunday 23:59:59 IST into the Sunday, and one second later into the Monday', () => {
    expect(clubDateOf(new Date('2026-10-25T18:29:59Z'))).toBe('2026-10-25')
    expect(clubDateOf(new Date('2026-10-25T18:30:00Z'))).toBe('2026-10-26')
  })

  it('rolls the month over at IST midnight, not UTC midnight', () => {
    expect(clubDateOf(new Date('2026-10-31T18:29:59Z'))).toBe('2026-10-31')
    expect(clubDateOf(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11-01')
    expect(clubDateOf(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01')
  })
})

describe('weekOf', () => {
  it('runs from Monday to Sunday', () => {
    expect(weekOf(date('2026-10-21'))).toEqual({ kind: 'week', first: '2026-10-19', last: '2026-10-25' })
  })

  it('keeps Sunday in the week that started the Monday before, and Monday starts a new one', () => {
    expect(weekOf(date('2026-10-25')).first).toBe('2026-10-19')
    expect(weekOf(date('2026-10-26')).first).toBe('2026-10-26')
  })

  it('crosses a year boundary', () => {
    expect(weekOf(date('2027-01-01'))).toEqual({ kind: 'week', first: '2026-12-28', last: '2027-01-03' })
  })
})

describe('monthOf', () => {
  it.each([
    ['2026-10-21', '2026-10-01', '2026-10-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-10', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
  ])('%s falls in %s to %s', (day, first, last) => {
    expect(monthOf(date(day))).toEqual({ kind: 'month', first, last })
  })
})

describe('periodOf and inPeriod', () => {
  it('counts the boundary days in and the days beyond them out', () => {
    const week = periodOf('week', date('2026-10-21'))
    expect(inPeriod(date('2026-10-19'), week)).toBe(true)
    expect(inPeriod(date('2026-10-25'), week)).toBe(true)
    expect(inPeriod(date('2026-10-18'), week)).toBe(false)
    expect(inPeriod(date('2026-10-26'), week)).toBe(false)
  })
})
