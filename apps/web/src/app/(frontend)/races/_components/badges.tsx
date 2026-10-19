import { isVerificationStale, type LocalDate, type PublicRace } from '@erc/domain'

import { formatDate } from './format'

const iconProps = { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const

export const CheckIcon = () => (
  <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
)

const CrossIcon = () => (
  <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
)

const ArrowIcon = () => (
  <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
  </svg>
)

const ClockIcon = () => (
  <svg {...iconProps} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.75V8l2.25 1.5" />
  </svg>
)

/** Each badge differs by icon and border style as well as colour, so none relies on colour alone. */
export function StatusBadge({ status }: { status: PublicRace['status'] }) {
  switch (status.kind) {
    case 'scheduled':
      return null
    case 'cancelled':
      return (
        <span className="badge badge-cancelled">
          <CrossIcon />
          Cancelled
        </span>
      )
    case 'postponed':
      return (
        <span className="badge badge-postponed">
          <ArrowIcon />
          {status.newStart ? `Postponed to ${formatDate(status.newStart)}` : 'Postponed, new date not announced'}
        </span>
      )
  }
}

export function StaleBadge({ race, today }: { race: PublicRace; today: LocalDate }) {
  if (!isVerificationStale(race, today)) return null
  return (
    <span className="badge badge-stale">
      <ClockIcon />
      Not recently checked
    </span>
  )
}
