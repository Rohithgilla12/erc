'use client'

import { usePathname } from 'next/navigation'
import React from 'react'

import { isCurrentSection, SITE_SECTIONS } from './site-nav'

export function SiteNavLinks() {
  const pathname = usePathname()
  return SITE_SECTIONS.map(({ href, label }) => (
    <a key={href} href={href} aria-current={isCurrentSection(pathname, href) ? 'page' : undefined}>
      {label}
    </a>
  ))
}
