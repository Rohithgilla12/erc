import { canonicalPathOf, nearestLandingPath, parseRaceQuery, todayIn, type LocalDate, type QueryParams, type RaceQuery } from '@erc/domain'
import type { Metadata } from 'next'

import { findRaces } from '@/content/races'

import { RaceCalendar } from './race-calendar'

import './races.css'

export type CalendarSearchParams = Promise<QueryParams>

export const readQuery = async (searchParams: CalendarSearchParams, fixed: QueryParams = {}) => {
  const params = await searchParams
  const today = todayIn('Asia/Kolkata')
  return { query: parseRaceQuery({ ...params, ...fixed }, today), today }
}

/** Landing views are indexable and self-canonical; every narrower view is noindex and points at its nearest landing page. */
export const calendarMetadata = (query: RaceQuery, today: LocalDate, title: string): Metadata => {
  const canonical = canonicalPathOf(query, today)
  return {
    title,
    alternates: { canonical: canonical ?? nearestLandingPath(query) },
    ...(canonical ? {} : { robots: { index: false, follow: true } }),
  }
}

export async function CalendarPage({ heading, query, today }: { heading: string; query: RaceQuery; today: LocalDate }) {
  return <RaceCalendar heading={heading} page={await findRaces(query)} query={query} today={today} />
}
