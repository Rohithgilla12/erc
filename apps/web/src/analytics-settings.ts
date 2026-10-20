const ANALYTICS_VARIABLES = ['UMAMI_URL', 'UMAMI_WEBSITE_ID'] as const

/** Where the browser loads Umami's tracker from, and which Umami website the page views count towards. */
export type AnalyticsSettings = { scriptUrl: string; websiteId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Both set means analytics, none set means no tracker at all. A partial or malformed set is a deploy mistake, so it
 * fails loudly at start-up rather than silently not counting. Plain http is allowed only for a local Umami.
 */
export const readAnalyticsSettings = (env: NodeJS.ProcessEnv): AnalyticsSettings | null => {
  const missing = ANALYTICS_VARIABLES.filter((name) => !env[name])
  if (missing.length === ANALYTICS_VARIABLES.length) return null
  if (missing.length > 0) throw new Error(`Analytics is partly configured. Set ${missing.join(', ')}, or unset both.`)
  let origin: URL
  try {
    origin = new URL(env.UMAMI_URL!)
  } catch {
    throw new Error(`UMAMI_URL must be the Umami origin, such as https://stats.example.org, not ${env.UMAMI_URL}`)
  }
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && LOCAL_HOSTS.has(origin.hostname))) {
    throw new Error('UMAMI_URL must use https')
  }
  if (!UUID.test(env.UMAMI_WEBSITE_ID!)) throw new Error('UMAMI_WEBSITE_ID must be the website id Umami shows, a UUID')
  return { scriptUrl: new URL('/script.js', origin).href, websiteId: env.UMAMI_WEBSITE_ID!.toLowerCase() }
}
