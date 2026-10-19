import type { Metadata } from 'next'
import { connection } from 'next/server'
import React, { type ReactNode } from 'react'

import { getPage, type RoutedPageSlug, type SitePage } from '@/content/pages'
import { siteConfig } from '@/site-config'

import { CLUB } from '../site-nav'

import { DEFAULT_PAGES } from './default-pages'
import { PageBlocks } from './page-blocks'

/** Rendered per request, so the image build needs no database and a publish shows on the next view. */
export const loadSitePage = async (slug: RoutedPageSlug): Promise<SitePage> => {
  await connection()
  return (await getPage(slug)) ?? DEFAULT_PAGES[slug]
}

const pathOf = (slug: RoutedPageSlug) => (slug === 'home' ? '/' : `/${slug}`)

const leadText = (page: SitePage) => {
  const first = page.blocks[0]
  return first?.kind === 'hero' ? first.body : null
}

export async function sitePageMetadata(slug: RoutedPageSlug): Promise<Metadata> {
  const page = await loadSitePage(slug)
  const title = page.seo.title || page.title
  const description = page.seo.description || leadText(page) || CLUB.description
  return {
    // The layout's template appends the club name, which would repeat it on the home page.
    title: slug === 'home' ? { absolute: page.seo.title || `${CLUB.name} | ${CLUB.tagline}` } : title,
    description,
    alternates: { canonical: pathOf(slug) },
    openGraph: {
      type: 'website',
      siteName: CLUB.name,
      url: pathOf(slug),
      title,
      description,
      ...(page.seo.imageUrl ? { images: [page.seo.imageUrl] } : {}),
    },
    ...(page.seo.noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

// JSON.stringify leaves `<` alone, so a value containing `</script>` could otherwise end the tag early.
const jsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

const organisation = () => {
  const { siteUrl } = siteConfig()
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    name: CLUB.name,
    alternateName: CLUB.shortName,
    description: CLUB.description,
    slogan: CLUB.tagline,
    sport: 'Running',
    url: new URL('/', siteUrl).href,
    logo: new URL('/brand/erc-logo-512.png', siteUrl).href,
    sameAs: [CLUB.instagramUrl],
  }
}

/** A route's page: its published blocks or the built-in default, then whatever the route adds after them. */
export async function SitePageView({ slug, children }: { slug: RoutedPageSlug; children?: ReactNode }) {
  const page = await loadSitePage(slug)
  return (
    <div className="page site-page">
      {slug === 'home' ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(organisation()) }} /> : null}
      {page.blocks[0]?.kind === 'hero' ? null : <h1>{page.title}</h1>}
      <PageBlocks blocks={page.blocks} />
      {children}
    </div>
  )
}
