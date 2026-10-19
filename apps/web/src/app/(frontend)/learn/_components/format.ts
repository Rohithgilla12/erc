import type { Instant } from '@erc/domain'

const DAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })

/** Calendar day in India, which is what a reader means by "published on". */
export const formatDay = (instant: Instant) => DAY.format(new Date(instant))

export const sameDay = (a: Instant, b: Instant) => formatDay(a) === formatDay(b)

export const formatReadingTime = (minutes: number) => `${minutes} min read`

export const namesOf = (people: readonly { name: string }[]) =>
  people.length <= 1 ? (people[0]?.name ?? '') : `${people.slice(0, -1).map((p) => p.name).join(', ')} and ${people.at(-1)?.name}`
