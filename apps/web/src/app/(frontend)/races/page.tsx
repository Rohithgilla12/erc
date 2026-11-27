import { cityBySlug, firstOf, RACES_PATH } from '@erc/domain'
import type { Metadata } from 'next'

import { findNearestRaces } from '@/content/races'
import { viewerHomeCity } from '@/members/run'

import { calendarMetadata, CalendarPage, readQuery, type CalendarSearchParams } from './_components/calendar-page'
import { NearForm, NearRaces } from './_components/near'

type Props = { searchParams: CalendarSearchParams }

/** Only a slug from the city table switches to the nearest view; anything else is ignored, so it adds no cache entry. */
const nearOf = async (searchParams: CalendarSearchParams) => cityBySlug(firstOf((await searchParams).near))

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const near = await nearOf(searchParams)
  if (near) {
    return {
      title: `Races near ${near.name}`,
      description: `Upcoming running races nearest ${near.name}, with dates, distances and how far away each one is.`,
      alternates: { canonical: RACES_PATH },
      robots: { index: false, follow: true },
    }
  }
  const { query, today } = await readQuery(searchParams)
  return calendarMetadata(query, today, 'Race calendar')
}

export default async function RacesPage({ searchParams }: Props) {
  const [near, homeCity, { query, today }] = await Promise.all([nearOf(searchParams), viewerHomeCity(), readQuery(searchParams)])
  if (near) return <NearRaces origin={near} races={await findNearestRaces(near)} today={today} homeCity={homeCity} />
  return <CalendarPage heading="Race calendar" query={query} today={today} near={<NearForm selected={homeCity} />} />
}
