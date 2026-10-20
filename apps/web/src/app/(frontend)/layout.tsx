import type { Metadata, Viewport } from 'next'
import Image from 'next/image'
import React from 'react'

import { siteConfig } from '@/site-config'

import { Analytics } from './analytics'
import { NewsletterSignup } from './newsletter/_components/newsletter-signup'
import { FEED_PATH, FEED_TITLE } from './learn/_components/feed'
import { CLUB, SITE_SECTIONS } from './site-nav'
import { SiteNavLinks } from './site-nav-links'
import './styles.css'

export const metadata: Metadata = {
  metadataBase: siteConfig().siteUrl,
  title: { default: CLUB.name, template: `%s | ${CLUB.name}` },
  description: CLUB.description,
  applicationName: CLUB.name,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1b1b19' },
  ],
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <head>
        {/* Not metadata `alternates.types`: a page that sets `alternates` for its canonical link replaces the layout's whole object. */}
        <link rel="alternate" type="application/rss+xml" href={FEED_PATH} title={FEED_TITLE} />
      </head>
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="brand" href="/">
              <Image className="brand-mark" src="/brand/erc-mark.png" alt="" width={97} height={40} priority unoptimized />
              <span className="brand-name-full">{CLUB.name}</span>
              <span className="brand-name-short">{CLUB.shortName}</span>
            </a>
            <nav className="site-nav" aria-label="Site">
              <SiteNavLinks />
            </nav>
          </div>
        </header>
        <main id="content">{children}</main>
        <footer className="site-footer">
          <div className="site-footer-inner">
            <NewsletterSignup />
            <p className="tagline">{CLUB.motto}</p>
            <nav aria-label="Footer">
              {SITE_SECTIONS.map(({ href, label }) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
              <a href={CLUB.instagramUrl} rel="me noopener">
                Instagram
              </a>
            </nav>
            <p>{CLUB.name}</p>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  )
}
