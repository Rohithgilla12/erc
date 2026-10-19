import type { Metadata } from 'next'
import React from 'react'
import './styles.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.ERC_SITE_URL || 'http://localhost:3000'),
  title: { default: 'ERC', template: '%s | ERC' },
  description: 'Race calendar, training plans and stories for runners in Telangana and Andhra Pradesh.',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
