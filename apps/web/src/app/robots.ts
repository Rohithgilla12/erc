import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/site-config'

// Built per request: at build time the site URL is not known yet, and a cached file would name localhost.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Files behind /downloads are linked from indexed pages; the playing view of a video is the same page plus YouTube.
      disallow: ['/admin', '/api', '/downloads/', '/videos/*?play=', '/videos/*&play='],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
