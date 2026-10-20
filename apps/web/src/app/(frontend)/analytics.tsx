import { connection } from 'next/server'
import React from 'react'

import { readAnalyticsSettings } from '@/analytics-settings'
import { siteConfig } from '@/site-config'

/**
 * Umami's cookieless tracker, configured per request so an image built without these settings still counts views
 * once they are set. It honours Do Not Track, counts only the real site's hostname, and drops query strings and
 * fragments, which can carry newsletter tokens, from both the page and the referrer it reports.
 */
export async function Analytics() {
  await connection()
  const settings = readAnalyticsSettings(process.env)
  if (!settings) return null
  return (
    <script
      defer
      src={settings.scriptUrl}
      data-website-id={settings.websiteId}
      data-domains={siteConfig().siteUrl.hostname}
      data-do-not-track="true"
      data-exclude-search="true"
      data-exclude-hash="true"
    />
  )
}
