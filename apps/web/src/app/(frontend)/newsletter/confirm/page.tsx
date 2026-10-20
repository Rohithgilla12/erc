import type { Metadata } from 'next'
import React from 'react'

import { confirmFromLink } from '@/content/newsletter-action'
import { checkConfirmLink } from '@/content/newsletter'

import '../_components/newsletter.css'

export const metadata: Metadata = { title: 'Newsletter subscription', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ token?: string | string[]; status?: string | string[] }> }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

/**
 * Opening the link only shows a button; confirming is a POST. Mail scanners open links before people do, and a GET
 * that confirmed would use the single-use link up before its owner arrived.
 */
export default async function ConfirmPage({ searchParams }: Props) {
  const params = await searchParams
  if (first(params.status) === 'confirmed') {
    return (
      <div className="page newsletter-page" role="status">
        <h1>You are subscribed</h1>
        <p>Thank you for confirming. The club newsletter will come to this address, and every email has a link to unsubscribe.</p>
        <p>
          <a href="/">Back to the home page</a>
        </p>
      </div>
    )
  }

  const token = first(params.token)
  const state = await checkConfirmLink(token)
  if (state === 'valid') {
    return (
      <div className="page newsletter-page">
        <h1>Confirm your subscription</h1>
        <p>One last step: confirm that you want the Endurance Run Club newsletter at this address.</p>
        <form action={confirmFromLink}>
          <input type="hidden" name="token" value={token} />
          <button className="button" type="submit">
            Confirm subscription
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="page newsletter-page">
      {state === 'expired' ? (
        <>
          <h1>This link has expired</h1>
          <p>Confirmation links work for 48 hours. Sign up again with the newsletter form and we will send you a new one.</p>
        </>
      ) : (
        <>
          <h1>This link has been used or is not valid</h1>
          <p>Each confirmation link works once. If you have already confirmed, you are subscribed. Otherwise sign up again with the newsletter form.</p>
        </>
      )}
    </div>
  )
}
