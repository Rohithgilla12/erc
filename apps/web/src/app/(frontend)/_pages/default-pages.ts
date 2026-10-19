import { parseLinkHref, type CtaLink, type Slug } from '@erc/domain'

import type { RoutedPageSlug, SitePage } from '@/content/pages'

import { CLUB } from '../site-nav'

export const COACHING_ENQUIRY_HREF = '/contact?topic=coaching#enquiry'

const link = (label: string, href: string): CtaLink => {
  const parsed = parseLinkHref(href)
  if (!parsed.ok) throw new Error(`Built-in page link ${href} is not a site path or https link`)
  return { label, href: parsed.value }
}

const noSeo = { title: null, description: null, imageUrl: null, noindex: false }

export const DEFAULT_PAGES: Readonly<Record<RoutedPageSlug, SitePage>> = {
  home: {
    slug: 'home' as Slug,
    title: CLUB.name,
    seo: noSeo,
    blocks: [
      {
        kind: 'hero',
        heading: CLUB.tagline,
        body: `${CLUB.description} Race calendar, training plans and coaching for runners in Telangana and Andhra Pradesh.`,
        primary: link('See upcoming races', '/races'),
        secondary: link('Coaching', '/coaching'),
      },
      { kind: 'featuredRaces', heading: 'Upcoming races', count: 3 },
    ],
  },
  about: {
    slug: 'about' as Slug,
    title: 'About',
    seo: noSeo,
    blocks: [
      {
        kind: 'hero',
        heading: `About ${CLUB.name}`,
        body: CLUB.description,
        primary: link('See upcoming races', '/races'),
        secondary: link('Contact us', '/contact'),
      },
    ],
  },
  coaching: {
    slug: 'coaching' as Slug,
    title: 'Coaching',
    seo: noSeo,
    blocks: [
      {
        kind: 'hero',
        heading: 'Coaching',
        body: 'Tell us about your running and what you are training for, and a coach will reply by email.',
        primary: link('Ask about coaching', COACHING_ENQUIRY_HREF),
        secondary: null,
      },
    ],
  },
  contact: {
    slug: 'contact' as Slug,
    title: 'Contact',
    seo: noSeo,
    blocks: [
      {
        kind: 'hero',
        heading: 'Contact us',
        body: 'Ask about coaching, races or working with the club, and we will reply by email.',
        primary: null,
        secondary: null,
      },
    ],
  },
}
