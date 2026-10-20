import type { MetadataRoute } from 'next'

import { sitemapEntries } from '@/content/sitemap'
import { siteConfig } from '@/site-config'

// Built per request: the image is built without a database, and the list changes with every publish.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = siteConfig()
  return (await sitemapEntries()).map(({ path, lastModified }) => ({
    url: new URL(path, siteUrl).href,
    ...(lastModified ? { lastModified } : {}),
  }))
}
