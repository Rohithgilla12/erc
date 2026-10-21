import type { BeforeListTableServerProps } from 'payload'
import React from 'react'

/** Only admins may export, so nobody else is shown a button that would answer 403. */
export function ExportSubscribersLink({ user }: BeforeListTableServerProps) {
  if (user?.role !== 'admin') return null
  return (
    <p style={{ margin: '0 0 1.5rem' }}>
      <a className="btn btn--style-secondary btn--size-small" href="/api/subscribers/export.csv" download>
        Download confirmed subscribers (CSV)
      </a>
    </p>
  )
}
