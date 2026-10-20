import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { Atkinson_Hyperlegible, Barlow_Condensed } from 'next/font/google'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { staffOf } from '../../access'

import { Handbook } from './handbook'
import { HANDBOOK_HREF } from './handbook-path'

import './handbook.css'

const display = Barlow_Condensed({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-hb-display' })
const body = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], style: ['normal', 'italic'], variable: '--font-hb-body' })

// Payload serves custom root views to anyone, so the staff check is this view's own job.
export function HandbookView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req } = initPageResult
  const staff = staffOf(req)
  if (!staff) redirect(`/admin/login?redirect=${encodeURIComponent(HANDBOOK_HREF)}`)

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={staff}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <Handbook className={`${display.variable} ${body.variable}`} />
      </Gutter>
    </DefaultTemplate>
  )
}
