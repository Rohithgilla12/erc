import type { Metadata } from 'next'

import { readyForm } from '@/content/enquiries'

import { SitePageView, sitePageMetadata } from '../_pages/site-page'

import { EnquiryForm } from './enquiry-form'

import './enquiry-form.css'

type Props = { searchParams: Promise<{ topic?: string | string[] }> }

export const generateMetadata = (): Promise<Metadata> => sitePageMetadata('contact')

export default async function ContactPage({ searchParams }: Props) {
  const { topic } = await searchParams
  return (
    <SitePageView slug="contact">
      <section id="enquiry" className="block" aria-labelledby="enquiry-heading">
        <h2 id="enquiry-heading">Send us a message</h2>
        <EnquiryForm initial={readyForm(Array.isArray(topic) ? topic[0] : topic)} />
      </section>
    </SitePageView>
  )
}
