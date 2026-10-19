import { subdivisionBySlug } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { calendarMetadata, CalendarPage, readQuery, type CalendarSearchParams } from '../../_components/calendar-page'

type Props = { params: Promise<{ state: string }>; searchParams: CalendarSearchParams }

const stateOf = async (params: Props['params']) => {
  const state = subdivisionBySlug((await params).state)
  if (!state) notFound()
  return state
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const state = await stateOf(params)
  const { query, today } = await readQuery(searchParams, { state: state.code })
  return calendarMetadata(query, today, `Races in ${state.name}`)
}

export default async function StateRacesPage({ params, searchParams }: Props) {
  const state = await stateOf(params)
  const { query, today } = await readQuery(searchParams, { state: state.code })
  return <CalendarPage heading={`Races in ${state.name}`} query={query} today={today} />
}
