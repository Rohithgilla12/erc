import type { Metadata } from 'next'

import { SitePageView, sitePageMetadata } from './_pages/site-page'

export const generateMetadata = (): Promise<Metadata> => sitePageMetadata('home')

export default function HomePage() {
  return <SitePageView slug="home" />
}
