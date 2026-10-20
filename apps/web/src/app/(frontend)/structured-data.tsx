import React from 'react'

import { siteConfig } from '@/site-config'

import { CLUB } from './site-nav'

export const absoluteUrl = (path: string) => new URL(path, siteConfig().siteUrl).href

// JSON.stringify leaves `<` alone, so a title containing `</script>` could otherwise end the tag early.
const serialise = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

/** One JSON-LD block. Pass a single node, or `{ '@graph': [...] }` for several. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialise({ '@context': 'https://schema.org', ...data }) }} />
}

export type Crumb = { name: string; path: string }

export const breadcrumbList = (crumbs: readonly Crumb[]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: absoluteUrl(crumb.path) })),
})

const organisationId = () => absoluteUrl('/#organization')

/** The club in full. It appears once, on the home page; every other page refers to it by `@id`. */
export const organisation = () => ({
  '@type': 'SportsOrganization',
  '@id': organisationId(),
  name: CLUB.name,
  alternateName: CLUB.shortName,
  description: CLUB.description,
  slogan: CLUB.motto,
  sport: 'Running',
  url: absoluteUrl('/'),
  logo: { '@type': 'ImageObject', url: absoluteUrl('/brand/erc-logo-512.png'), width: 512, height: 512 },
  sameAs: [CLUB.instagramUrl],
})

/** Enough of the club for a publisher or provider field to resolve without the home page. */
export const organisationRef = () => ({
  '@type': 'SportsOrganization',
  '@id': organisationId(),
  name: CLUB.name,
  url: absoluteUrl('/'),
  logo: { '@type': 'ImageObject', url: absoluteUrl('/brand/erc-logo-512.png'), width: 512, height: 512 },
})

export const website = () => ({
  '@type': 'WebSite',
  '@id': absoluteUrl('/#website'),
  url: absoluteUrl('/'),
  name: CLUB.name,
  alternateName: CLUB.shortName,
  description: CLUB.description,
  inLanguage: 'en-IN',
  publisher: { '@id': organisationId() },
})

/** A page that lists other pages, with its trail. `path` is the canonical path, so the node names the indexed URL. */
export const collectionPage = ({ name, description, path, crumbs }: { name: string; description?: string; path: string; crumbs: readonly Crumb[] }) => ({
  '@graph': [
    { '@type': 'CollectionPage', name, ...(description ? { description } : {}), url: absoluteUrl(path) },
    breadcrumbList(crumbs),
  ],
})
