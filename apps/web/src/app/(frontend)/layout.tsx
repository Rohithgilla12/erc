import type { Metadata, Viewport } from 'next'
import React from 'react'
import './styles.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.ERC_SITE_URL || 'http://localhost:3000'),
  title: { default: 'ERC', template: '%s | ERC' },
  description: 'Race calendar, training plans and stories for runners in Telangana and Andhra Pradesh.',
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
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="site-header-inner">
            <a className="brand" href="/">
              ERC
            </a>
            <nav className="site-nav" aria-label="Site">
              <a href="/races">Race calendar</a>
            </nav>
          </div>
        </header>
        <main id="content">{children}</main>
      </body>
    </html>
  )
}
