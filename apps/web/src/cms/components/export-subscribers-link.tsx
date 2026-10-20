import React from 'react'

export function ExportSubscribersLink() {
  return (
    <p style={{ margin: '0 0 1.5rem' }}>
      <a className="btn btn--style-secondary btn--size-small" href="/api/subscribers/export.csv" download>
        Download confirmed subscribers (CSV)
      </a>
    </p>
  )
}
