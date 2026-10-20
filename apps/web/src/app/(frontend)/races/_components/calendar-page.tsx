import {
  canonicalPathOf,
  nearestLandingPath,
  parseRaceQuery,
  racesHref,
  RACES_PATH,
  todayIn,
  type LocalDate,
  type QueryParams,
  type RaceQuery,
} from '@erc/domain'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { findRaces } from '@/content/races'

import { collectionPage, JsonLd } from '../../structured-data'

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
    description: describe(title),
    alternates: { canonical: canonical ?? nearestLandingPath(query) },
    ...(canonical ? {} : { robots: { index: false, follow: true } }),
  }
}

const describe = (heading: string) =>
  `${heading}: upcoming running races with dates, distances, registration deadlines and official links.`

const CALENDAR_PATH = /^\/races(\/|$)/

/**
 * True unless the runner came here from a calendar or race page on this site. Filter chips, the filter form,
 * pagination and "All races" all send a same-origin Referer, so this tells a first visit from a filter change
 * without JavaScript. A missing or unparseable Referer counts as an arrival.
 */
const isArrival = async () => {
  const request = await headers()
  const referer = request.get('referer')
  if (!referer) return true
  try {
    const from = new URL(referer)
    return from.host !== request.get('host') || !CALENDAR_PATH.test(from.pathname)
  } catch {
    return true
  }
}

export async function CalendarPage({ heading, query, today }: { heading: string; query: RaceQuery; today: LocalDate }) {
  const [page, arrival] = await Promise.all([findRaces(query), isArrival()])
  // Temporary, because the page can exist again once more races are listed. One URL per page of results keeps a
  // stale link from rendering an empty, indexable duplicate.
  if (page.page !== query.page) redirect(racesHref({ ...query, page: page.page }, today))
  // Narrower views are noindex and their heading does not name the page their canonical link points at, so only
  // indexable views describe themselves.
  const canonical = canonicalPathOf(query, today)
  const landing = nearestLandingPath(query)
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Races', path: RACES_PATH },
    ...(landing === RACES_PATH ? [] : [{ name: heading, path: landing }]),
  ]
  return (
    <>
      {canonical ? <JsonLd data={collectionPage({ name: heading, description: describe(heading), path: canonical, crumbs })} /> : null}
      <RaceCalendar heading={heading} page={page} query={query} today={today} arrival={arrival} />
    </>
  )
}
