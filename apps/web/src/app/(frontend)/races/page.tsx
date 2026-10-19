import type { Metadata } from 'next'

import { calendarMetadata, CalendarPage, readQuery, type CalendarSearchParams } from './_components/calendar-page'

type Props = { searchParams: CalendarSearchParams }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { query, today } = await readQuery(searchParams)
  return calendarMetadata(query, today, 'Race calendar')
}

export default async function RacesPage({ searchParams }: Props) {
  const { query, today } = await readQuery(searchParams)
  return <CalendarPage heading="Race calendar" query={query} today={today} />
}
