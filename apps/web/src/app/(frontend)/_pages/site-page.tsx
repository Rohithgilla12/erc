import type { Metadata } from 'next'
import { connection } from 'next/server'
import React, { type ReactNode } from 'react'

import { getPage, type RoutedPageSlug, type SitePage } from '@/content/pages'
import { absoluteUrl } from '@/site-config'

import { CLUB } from '../site-nav'
import { breadcrumbList, JsonLd, organisation, website } from '../structured-data'

import { DEFAULT_PAGES } from './default-pages'
import { PageBlocks } from './page-blocks'

/** Rendered per request, so the image build needs no database and a publish shows on the next view. */
export const loadSitePage = async (slug: RoutedPageSlug): Promise<SitePage> => {
  await connection()
  return (await getPage(slug)) ?? DEFAULT_PAGES[slug]
}

const pathOf = (slug: RoutedPageSlug) => (slug === 'home' ? '/' : `/${slug}`)

const hero = (page: SitePage) => (page.blocks[0]?.kind === 'hero' ? page.blocks[0] : null)

const leadText = (page: SitePage) => hero(page)?.body ?? null

const descriptionOf = (page: SitePage) => page.seo.description ?? leadText(page) ?? CLUB.description

export async function sitePageMetadata(slug: RoutedPageSlug): Promise<Metadata> {
  const page = await loadSitePage(slug)
  const title = page.seo.title ?? page.title
  const description = descriptionOf(page)
  return {
    // The layout's template appends the club name, which would repeat it on the home page.
    title: slug === 'home' ? { absolute: page.seo.title ?? `${CLUB.name} | ${CLUB.tagline}` } : title,
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

const PAGE_TYPE: Record<RoutedPageSlug, string> = { home: 'WebPage', about: 'AboutPage', coaching: 'WebPage', contact: 'ContactPage' }

/** The home page carries the club and the site in full; the others describe themselves and their place under it. */
const structuredData = (slug: RoutedPageSlug, page: SitePage) => {
  if (slug === 'home') return { '@graph': [organisation(), website()] }
  const path = pathOf(slug)
  return {
    '@graph': [
      { '@type': PAGE_TYPE[slug], name: hero(page)?.heading ?? page.title, description: descriptionOf(page), url: absoluteUrl(path) },
      breadcrumbList([
        { name: 'Home', path: '/' },
        { name: page.title, path },
      ]),
    ],
  }
}

export async function SitePageView({ slug, children }: { slug: RoutedPageSlug; children?: ReactNode }) {
  const page = await loadSitePage(slug)
  return (
    <div className="page site-page">
      <JsonLd data={structuredData(slug, page)} />
      {hero(page) ? null : <h1>{page.title}</h1>}
      <PageBlocks blocks={page.blocks} />
      {children}
    </div>
  )
}
