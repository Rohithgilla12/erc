import type { Metadata } from 'next'

import { SitePageView, sitePageMetadata } from '../_pages/site-page'

export const generateMetadata = (): Promise<Metadata> => sitePageMetadata('contact')

export default function ContactPage() {
  return <SitePageView slug="contact" />
}
