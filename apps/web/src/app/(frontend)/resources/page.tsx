import { RESOURCE_CATEGORIES, type DownloadableResource, type ResourceCategory } from '@erc/domain'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { downloadPath, getResources } from '@/content/resources'
import { siteConfig } from '@/site-config'

import { accessLabel, describeFile, jsonLd } from '../plans/_components/format'

import '../plans/_components/plans.css'

const DESCRIPTION = 'Free printable plans, checklists, guides, and spreadsheets from Endurance Run Club coaches.'

export const metadata: Metadata = {
  title: 'Downloads',
  description: DESCRIPTION,
  alternates: { canonical: '/resources' },
}

const HEADINGS: Record<ResourceCategory, string> = {
  'plan-pdf': 'Printable plans',
  checklist: 'Checklists',
  guide: 'Guides',
  spreadsheet: 'Spreadsheets',
}

const collectionPage = (resources: readonly DownloadableResource[]) => {
  const site = siteConfig().siteUrl
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Downloads',
    description: DESCRIPTION,
    url: new URL('/resources', site).href,
    hasPart: resources.map((resource) => ({
      '@type': 'DigitalDocument',
      name: resource.title,
      description: resource.description,
      url: new URL(downloadPath(resource), site).href,
      encodingFormat: resource.file.mimeType,
      contentSize: `${resource.file.bytes} B`,
      isAccessibleForFree: resource.access.kind === 'free',
      datePublished: resource.publishedAt,
      dateModified: resource.updatedAt,
    })),
  }
}

export default async function ResourcesPage() {
  // Read per request, never at build time: the image is built without a database.
  await connection()
  const resources = await getResources()
  const groups = RESOURCE_CATEGORIES.map((category) => ({
    category,
    items: resources.filter((resource) => resource.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="page resources">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(collectionPage(resources))} />
      <header className="plans-head">
        <h1>Downloads</h1>
        <p className="lede">Free files to print or keep on your phone. Looking for a schedule? Every plan is also readable on its <a href="/plans">plan page</a>.</p>
      </header>

      {groups.length === 0 ? <p className="empty">Downloads are on their way.</p> : null}

      {groups.map(({ category, items }) => (
        <section key={category} aria-labelledby={`${category}-heading`} className="resource-group">
          <h2 id={`${category}-heading`}>{HEADINGS[category]}</h2>
          <ul className="resource-list">
            {items.map((resource) => (
              <li key={resource.slug} className="resource-card">
                <h3>
                  <a href={downloadPath(resource)}>{resource.title}</a>
                </h3>
                <p>{resource.description}</p>
                <p className="resource-meta">
                  <span>{describeFile(resource.file)}</span>
                  <span>{accessLabel(resource.access)}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
