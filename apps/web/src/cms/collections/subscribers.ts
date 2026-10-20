import { SIGNUP_SOURCES, type SignupSource, type SubscriberStatus } from '@erc/domain'
import type { Endpoint, Field, Payload } from 'payload'

import { staffOf } from '../access'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

const CLUB_NAME = 'Endurance Run Club'

const STATUS_LABELS: Record<SubscriberStatus, string> = { pending: 'Pending confirmation', confirmed: 'Confirmed', unsubscribed: 'Unsubscribed' }
const SOURCE_LABELS: Record<SignupSource, string> = { 'site-footer': 'Site footer form' }

/** Throws when the relay refuses, so the caller can log it against the signup without saying so to the visitor. */
export async function sendConfirmationEmail(payload: Payload, to: string, links: { confirm: URL; unsubscribe: URL }) {
  await payload.sendEmail({
    to,
    subject: `Confirm your ${CLUB_NAME} newsletter signup`,
    text: [
      'Hello,',
      '',
      `Someone, hopefully you, asked for the ${CLUB_NAME} newsletter to come to this address. Please confirm by opening this link within 48 hours:`,
      '',
      links.confirm.href,
      '',
      'If that was not you, ignore this email and we will not write again.',
      '',
      `To cancel or unsubscribe at any time: ${links.unsubscribe.href}`,
    ].join('\n'),
  })
}

const csvCell = (value: string) => {
  // A leading =, +, - or @ makes a spreadsheet run the cell as a formula; an email local part may start with any of them.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const ymd = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '')

/** `GET /api/subscribers/export.csv`: confirmed addresses only, for staff. */
const exportConfirmed: Endpoint = {
  path: '/export.csv',
  method: 'get',
  handler: async (req) => {
    if (!staffOf(req)) return Response.json({ errors: [{ message: 'You are not allowed to perform this action.' }] }, { status: 403 })
    const { docs } = await req.payload.find({
      collection: 'subscribers',
      where: { status: { equals: 'confirmed' satisfies SubscriberStatus } },
      sort: 'confirmedAt',
      pagination: false,
      depth: 0,
      select: { email: true, source: true, consentedAt: true, confirmedAt: true },
    })
    const rows = docs.map((doc) => [doc.email, doc.confirmedAt ?? '', doc.consentedAt, doc.source].map(csvCell).join(','))
    return new Response(['email,confirmed_at,consented_at,source', ...rows].join('\r\n') + '\r\n', {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${ymd(new Date())}-erc-newsletter-subscribers.csv"`,
        'cache-control': 'private, no-store',
      },
    })
  },
}

const dayAndTime = { date: { pickerAppearance: 'dayAndTime' as const } }
const hidden = { hidden: true }

const fields: Field[] = [
  { name: 'email', type: 'email', required: true, unique: true, index: true },
  {
    name: 'status',
    type: 'select',
    required: true,
    defaultValue: 'pending' satisfies SubscriberStatus,
    options: optionsFrom(STATUS_LABELS),
    index: true,
    admin: { position: 'sidebar' },
  },
  {
    name: 'source',
    label: 'Signed up through',
    type: 'select',
    required: true,
    defaultValue: SIGNUP_SOURCES[0],
    options: optionsFrom(SOURCE_LABELS),
    admin: { position: 'sidebar' },
  },
  {
    name: 'consentedAt',
    label: 'Asked to join',
    type: 'date',
    required: true,
    admin: { ...dayAndTime, description: 'When they last sent the signup form and we emailed them a confirmation link.' },
  },
  { name: 'confirmedAt', label: 'Confirmed', type: 'date', admin: dayAndTime },
  // A SHA-256 of the emailed link's token. Confirming clears it, so a link works once.
  { name: 'confirmTokenHash', type: 'text', index: true, admin: hidden },
  { name: 'confirmExpiresAt', type: 'date', admin: hidden },
  // A keyed hash of the sender's network, for the per-sender rate limit. The address itself is never stored.
  { name: 'senderKey', type: 'text', admin: hidden },
]

export const Subscribers = defineRecord({
  slug: 'subscribers',
  visibility: 'private',
  labels: { singular: 'Subscriber', plural: 'Subscribers' },
  defaultSort: '-consentedAt',
  // Only the signup flow writes, through the Local API, so nobody is added without confirming. Staff may delete a row to erase someone.
  access: { create: () => false, update: () => false },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'status', 'consentedAt', 'confirmedAt'],
    description: 'Newsletter signups. Email only confirmed subscribers. Delete a subscriber to erase them on request.',
    components: { beforeListTable: ['/cms/components/export-subscribers-link#ExportSubscribersLink'] },
  },
  indexes: [{ fields: ['senderKey', 'consentedAt'] }],
  endpoints: [exportConfirmed],
  fields,
})
