/** Server-side settings from the environment. Nothing here is sent to the browser. */
export type SiteConfig = {
  /** Origin of the public site: the base for canonical links, and where scripts ask the server to revalidate. */
  siteUrl: URL
  /** Shared with scripts that call `POST /api/revalidate`. Null only outside production. */
  revalidateSecret: string | null
}

const REQUIRED_IN_PRODUCTION = ['ERC_SITE_URL', 'REVALIDATE_SECRET'] as const

/**
 * Production refuses to run without both: a missing site URL makes every canonical link point at localhost, and a
 * missing secret leaves scripts unable to refresh the site. `next build` also runs as production, but the image is
 * built without runtime settings, so the build phase falls back to the development defaults.
 */
export const readSiteConfig = (env: NodeJS.ProcessEnv): SiteConfig => {
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !env[name])
  if (env.NODE_ENV === 'production' && env.NEXT_PHASE !== 'phase-production-build' && missing.length > 0) {
    throw new Error(`ERC will not start in production without ${REQUIRED_IN_PRODUCTION.join(' and ')}. Missing: ${missing.join(', ')}`)
  }
  return { siteUrl: new URL(env.ERC_SITE_URL || 'http://localhost:3000'), revalidateSecret: env.REVALIDATE_SECRET || null }
}

let config: SiteConfig | undefined

export const siteConfig = (): SiteConfig => (config ??= readSiteConfig(process.env))
