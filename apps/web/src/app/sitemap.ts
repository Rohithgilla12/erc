import type { MetadataRoute } from 'next'

import { sitemapEntries } from '@/content/sitemap'
import { absoluteUrl } from '@/site-config'

// Built per request: the image is built without a database, and the list changes with every publish.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await sitemapEntries()).map(({ path, lastModified }) => ({
    url: absoluteUrl(path),
    ...(lastModified ? { lastModified } : {}),
  }))
}
