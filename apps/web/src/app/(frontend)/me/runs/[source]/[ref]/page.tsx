import type { Metadata } from 'next'
import React from 'react'

import { requireMember, run } from '@/members/run'

import { RunDetailBody } from '../../../run-detail'

import '../../../members.css'

export const metadata: Metadata = { title: 'Run', robots: { index: false, follow: false } }

type Props = { params: Promise<{ source: string; ref: string }> }

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function RunPage({ params }: Props) {
  const caller = await requireMember()
  const { source, ref } = await params
  const detail = await run('runDetail', caller, { source, ref: decoded(ref) })
  return (
    <div className="page member-page">
      <p>
        <a href="/me#recent-runs">&larr; Back to my running</a>
      </p>
      {detail.ok ? (
        <RunDetailBody detail={detail.data} viewer="self" />
      ) : (
        <p className="member-alert" role="alert">
          {detail.error.code === 'invalid' || detail.error.code === 'not_found' ? 'That run is not in your log.' : detail.error.message}
        </p>
      )}
    </div>
  )
}
