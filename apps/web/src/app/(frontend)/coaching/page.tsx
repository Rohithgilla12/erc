import type { Metadata } from 'next'

import { COACHING_ENQUIRY_HREF } from '../_pages/default-pages'
import { SitePageView, sitePageMetadata } from '../_pages/site-page'

export const generateMetadata = (): Promise<Metadata> => sitePageMetadata('coaching')

/** The way to ask stays on the page whatever the editors publish above it. */
export default function CoachingPage() {
  return (
    <SitePageView slug="coaching">
      <section className="block block-cta">
        <h2>Ask about coaching</h2>
        <p>Tell us where your running is now and what you are training for.</p>
        <p>
          <a className="button" href={COACHING_ENQUIRY_HREF}>
            Send a coaching enquiry
          </a>
        </p>
      </section>
    </SitePageView>
  )
}
