import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import React from 'react'

import { newsletterOpen } from '@/content/newsletter'

import './_components/newsletter.css'

export const metadata: Metadata = {
  title: 'Newsletter',
  description: 'New training plans, articles and races worth entering, by email from Endurance Run Club.',
  alternates: { canonical: '/newsletter' },
}

/** Where the footer form lands with JavaScript off; the footer below shows the result. */
export default async function NewsletterPage() {
  await connection()
  if (!newsletterOpen()) notFound()
  return (
    <div className="page newsletter-page">
      <h1>Newsletter</h1>
      <p>
        New training plans, articles and races worth entering, by email. We write only to addresses that have confirmed, and every
        email has a link to unsubscribe.
      </p>
      <p>
        <a href="#newsletter">Sign up below</a>
      </p>
    </div>
  )
}
