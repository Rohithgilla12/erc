import { connection } from 'next/server'
import React from 'react'

import { newsletterOpen, readySignup } from '@/content/newsletter'

import { NewsletterForm } from './newsletter-form'

import './newsletter.css'

/**
 * Decided per request, never at build time: the image is built without SMTP settings, and the form's time token must
 * be issued when the page is served.
 */
export async function NewsletterSignup() {
  await connection()
  if (!newsletterOpen()) return null
  return (
    <section id="newsletter" className="newsletter" aria-labelledby="newsletter-heading">
      <div className="newsletter-intro">
        <h2 id="newsletter-heading">Club newsletter</h2>
        <p>New training plans, articles and races worth entering, by email.</p>
      </div>
      <NewsletterForm initial={readySignup()} />
    </section>
  )
}
