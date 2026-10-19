import type { Metadata } from 'next'

import { SitePageView, sitePageMetadata } from '../_pages/site-page'

export const generateMetadata = (): Promise<Metadata> => sitePageMetadata('about')

export default function AboutPage() {
  return <SitePageView slug="about" />
}
