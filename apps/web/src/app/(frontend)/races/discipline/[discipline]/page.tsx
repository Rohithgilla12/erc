import { DISCIPLINES, type Discipline } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { calendarMetadata, CalendarPage, readQuery, type CalendarSearchParams } from '../../_components/calendar-page'
import { DISCIPLINE_LABELS } from '../../_components/format'

type Props = { params: Promise<{ discipline: string }>; searchParams: CalendarSearchParams }

const disciplineOf = async (params: Props['params']): Promise<Discipline> => {
  const { discipline } = await params
  const known = DISCIPLINES.find((d) => d === discipline)
  if (!known) notFound()
  return known
}

const headingFor = (discipline: Discipline) => `${DISCIPLINE_LABELS[discipline]} races`

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const discipline = await disciplineOf(params)
  const { query, today } = await readQuery(searchParams, { discipline })
  return calendarMetadata(query, today, headingFor(discipline))
}

export default async function DisciplineRacesPage({ params, searchParams }: Props) {
  const discipline = await disciplineOf(params)
  const { query, today } = await readQuery(searchParams, { discipline })
  return <CalendarPage heading={headingFor(discipline)} query={query} today={today} />
}
