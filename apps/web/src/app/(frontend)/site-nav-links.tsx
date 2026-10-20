'use client'

import { usePathname } from 'next/navigation'
import React, { useEffect, useRef } from 'react'

import { isCurrentSection, SITE_SECTIONS } from './site-nav'

// The phone nav fades out over its last 15% (`.site-nav` in styles.css), so a current link there reads as hidden.
const CLEAR_WIDTH = 0.85

export function SiteNavLinks() {
  const pathname = usePathname()
  const current = useRef<HTMLAnchorElement>(null)

  // For browsers without CSS scroll-initial-target (see styles.css); where it works, the link is already clear and this does nothing.
  useEffect(() => {
    const link = current.current
    const nav = link?.parentElement
    if (!link || !nav || nav.scrollWidth <= nav.clientWidth) return
    const start = link.getBoundingClientRect().left - nav.getBoundingClientRect().left
    if (start >= 0 && start + link.offsetWidth <= nav.clientWidth * CLEAR_WIDTH) return
    nav.scrollTo({ left: nav.scrollLeft + start - (nav.clientWidth - link.offsetWidth) / 2, behavior: 'instant' })
  }, [pathname])

  return SITE_SECTIONS.map(({ href, label }) => {
    const isCurrent = isCurrentSection(pathname, href)
    return (
      <a key={href} ref={isCurrent ? current : undefined} href={href} aria-current={isCurrent ? 'page' : undefined}>
        {label}
      </a>
    )
  })
}
