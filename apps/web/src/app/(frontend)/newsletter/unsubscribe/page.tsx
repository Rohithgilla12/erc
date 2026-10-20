import type { Metadata } from 'next'
import React from 'react'

import { unsubscribeFromLink } from '@/content/newsletter-action'
import { unsubscribeLinkValid } from '@/content/newsletter'

import '../_components/newsletter.css'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ token?: string | string[]; status?: string | string[] }> }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

/** Like confirming, unsubscribing is a POST behind a button, so a mail scanner opening the link changes nothing. */
export default async function UnsubscribePage({ searchParams }: Props) {
  const params = await searchParams
  if (first(params.status) === 'done') {
    return (
      <div className="page newsletter-page" role="status">
        <h1>You are unsubscribed</h1>
        <p>We will not send the newsletter to this address again. If you change your mind, sign up again at any time.</p>
        <p>
          <a href="/">Back to the home page</a>
        </p>
      </div>
    )
  }

  const token = first(params.token)
  if (!unsubscribeLinkValid(token)) {
    return (
      <div className="page newsletter-page">
        <h1>This unsubscribe link is not valid</h1>
        <p>
          Check that you copied the whole link from the email, or <a href="/contact">contact us</a> and we will remove your address.
        </p>
      </div>
    )
  }

  return (
    <div className="page newsletter-page">
      <h1>Unsubscribe from the newsletter</h1>
      <p>We will stop sending the Endurance Run Club newsletter to this address.</p>
      <form action={unsubscribeFromLink}>
        <input type="hidden" name="token" value={token} />
        <button className="button" type="submit">
          Unsubscribe
        </button>
      </form>
    </div>
  )
}
