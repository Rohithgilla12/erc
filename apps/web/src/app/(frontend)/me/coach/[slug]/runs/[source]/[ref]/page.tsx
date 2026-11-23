import type { Metadata } from 'next'
import React from 'react'

import { requireCoach, run } from '@/members/run'

import { RunDetailBody } from '../../../../../run-detail'

import '../../../../../members.css'

export const metadata: Metadata = { title: 'Athlete run', robots: { index: false, follow: false } }

type Props = { params: Promise<{ slug: string; source: string; ref: string }> }

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function AthleteRunPage({ params }: Props) {
  const caller = await requireCoach()
  const { slug, source, ref } = await params
  const detail = await run('athleteRunDetail', caller, { athleteSlug: slug, source, ref: decoded(ref) })
  return (
    <div className="page member-page">
      <p>
        <a href={`/me/coach/${encodeURIComponent(slug)}`}>&larr; Back to the athlete&rsquo;s week</a>
      </p>
      {detail.ok ? (
        <RunDetailBody detail={detail.data} viewer="coach" />
      ) : (
        <p className="member-alert" role="alert">
          {detail.error.code === 'invalid' || detail.error.code === 'not_found' ? "That run is not in this athlete's log." : detail.error.message}
        </p>
      )}
    </div>
  )
}
