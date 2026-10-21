import { readAnalyticsSettings } from './analytics-settings'
import { readSmtpSettings } from './cms/email-settings'
import { siteConfig } from './site-config'

/** Next calls this once as the server starts, before it takes requests. */
export async function register() {
  try {
    siteConfig()
    readSmtpSettings(process.env)
    readAnalyticsSettings(process.env)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    // A failed register only makes Next answer every request with a 500 while the process stays up and looks healthy.
    if (process.env.NEXT_RUNTIME === 'nodejs') process.exit(1)
    throw error
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { schedulePurge } = await import('./content/newsletter')
    schedulePurge()
    const { scheduleMemberPurge } = await import('./members/purge')
    scheduleMemberPurge()
  }
}
