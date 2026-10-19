import { siteConfig } from './site-config'

/** Next calls this once as the server starts, before it takes requests. */
export function register() {
  try {
    siteConfig()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    // A failed register only makes Next answer every request with a 500 while the process stays up and looks healthy.
    if (process.env.NEXT_RUNTIME === 'nodejs') process.exit(1)
    throw error
  }
}
