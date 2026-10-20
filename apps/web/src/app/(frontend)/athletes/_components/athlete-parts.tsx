import {
  DISTANCE_CATEGORIES,
  subdivisionOf,
  type Athlete,
  type DistanceCategory,
  type LocalDate,
  type Metres,
} from '@erc/domain'
import Image from 'next/image'


const CATEGORY_LABELS = new Map<DistanceCategory, string>(DISTANCE_CATEGORIES.map(({ key, label }) => [key, label]))

const km = (metres: Metres) => `${Number((metres / 1000).toFixed(1))} km`

/** A PB slot by its race name; any other distance in kilometres. */
export const distanceLabel = (category: DistanceCategory, metres: Metres) => {
  if (category === 'ultra-multiday') return `Multi-day, ${km(metres)}`
  return CATEGORY_LABELS.get(category) ?? km(metres)
}

export const categoryLabel = (category: DistanceCategory) =>
  category === 'ultra-multiday' ? 'Multi-day' : (CATEGORY_LABELS.get(category) ?? 'Other')

// A LocalDate is a calendar fact, so it is formatted at UTC midnight to keep the day from shifting.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const formatResultDate = (date: LocalDate) => dateFormat.format(new Date(`${date}T00:00:00Z`))

export const homeOf = ({ home }: Athlete) => {
  const state = subdivisionOf(home.subdivision).name
  return home.city ? `${home.city}, ${state}` : state
}

const initialsOf = (name: string) => {
  const words = name.trim().split(/\s+/)
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** Decorative: the name always sits next to it, so the image has empty alt text. */
export function Avatar({ athlete, size }: { athlete: Athlete; size: 'card' | 'profile' }) {
  const pixels = size === 'profile' ? 96 : 56
  if (athlete.photoUrl) {
    return (
      <Image
        className={`athlete-avatar athlete-avatar-${size}`}
        src={athlete.photoUrl}
        alt=""
        width={pixels}
        height={pixels}
        unoptimized
        loading={size === 'card' ? 'lazy' : 'eager'}
      />
    )
  }
  return (
    <span className={`athlete-avatar athlete-avatar-${size} athlete-avatar-initials`} aria-hidden="true">
      {initialsOf(athlete.name)}
    </span>
  )
}

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const

/** Verified and self-reported differ by icon, border style, and words, so neither relies on colour. */
export function Proof({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="proof proof-verified">
      <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8.5 6.5 12 13 4.5" />
      </svg>
      Verified
    </span>
  ) : (
    <span className="proof proof-self">Self-reported</span>
  )
}

export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="back-link" href={href}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {children}
    </a>
  )
}
