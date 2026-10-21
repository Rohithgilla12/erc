import { addDays, todayIn, type LocalDate } from './primitives'

/** India has no daylight saving, so a club date is the UTC instant plus 5:30. Weeks start on Monday 00:00 IST. */
export const CLUB_TIME_ZONE = 'Asia/Kolkata'

/** The club-local calendar date of an instant. */
export const clubDateOf = (now: Date): LocalDate => todayIn(CLUB_TIME_ZONE, now)

export type PeriodKind = 'week' | 'month'

/** An inclusive run of club dates. Built only by `weekOf` and `monthOf`, so `first` and `last` always agree with `kind`. */
export type Period = { kind: PeriodKind; first: LocalDate; last: LocalDate }

// Monday is 0 here, so the offset back to the week's first day is the weekday itself.
const mondayBasedWeekday = (date: LocalDate): number => {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number)
  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day)
  return (utc.getUTCDay() + 6) % 7
}

export const weekOf = (date: LocalDate): Period => {
  const first = addDays(date, -mondayBasedWeekday(date))
  return { kind: 'week', first, last: addDays(first, 6) }
}

export const monthOf = (date: LocalDate): Period => {
  const first = `${date.slice(0, 7)}-01` as LocalDate
  const [year = 0, month = 0] = date.split('-').map(Number)
  const next = month === 12 ? `${String(year + 1).padStart(4, '0')}-01-01` : `${date.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-01`
  return { kind: 'month', first, last: addDays(next as LocalDate, -1) }
}

export const periodOf = (kind: PeriodKind, date: LocalDate): Period => (kind === 'week' ? weekOf(date) : monthOf(date))

export const inPeriod = (date: LocalDate, period: Period): boolean => date >= period.first && date <= period.last
