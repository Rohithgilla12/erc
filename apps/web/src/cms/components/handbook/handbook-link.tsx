import Link from 'next/link'
import React from 'react'

import { HANDBOOK_HREF as HREF } from './handbook-path'

/** Sits after the collection links, styled as one of them. */
export function HandbookNavLink() {
  return (
    <Link className="nav__link" href={HREF} prefetch={false}>
      <span className="nav__link-label">Handbook</span>
    </Link>
  )
}

/** Shown above the dashboard so a new coach finds the guide before anything else. */
export function HandbookDashboardNote() {
  return (
    <p style={{ margin: '0 0 1.5rem' }}>
      New here? <Link href={HREF}>Read the admin handbook</Link> for how writing, review, and approval work.
    </p>
  )
}
