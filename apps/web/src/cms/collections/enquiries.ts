import { ENQUIRY_TOPICS } from '@erc/domain'
import type { Payload } from 'payload'

import type { Enquiry } from '../../payload-types'
import { absoluteUrl } from '../../site-config'
import { enquiryRecipient } from '../email'
import { labelsOf, optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

type EnquiryStatus = 'new' | 'handled'

const TOPIC_LABELS = labelsOf(ENQUIRY_TOPICS)

/**
 * Never throws: the enquiry is already stored and staff see it in the admin whether or not the email goes out. Callers
 * run it after the create has committed, so a slow relay never holds a transaction open. `lastThisHour` marks the email
 * that uses up the hourly cap, so staff know to look in the admin for the rest.
 */
export async function notifyStaffOfEnquiry(payload: Payload, enquiry: Enquiry, { lastThisHour }: { lastThisHour: boolean }) {
  const to = enquiryRecipient()
  if (!to) return
  const topic = TOPIC_LABELS[enquiry.topic]
  try {
    await payload.sendEmail({
      to,
      replyTo: enquiry.email,
      subject: `${topic} enquiry from ${enquiry.name}`,
      text: [
        `${enquiry.name} <${enquiry.email}>${enquiry.phone ? `, ${enquiry.phone}` : ''}`,
        `Topic: ${topic}`,
        '',
        enquiry.message,
        '',
        `Reply to this email to answer them, then mark it handled: ${absoluteUrl(`/admin/collections/enquiries/${enquiry.id}`)}`,
        ...(lastThisHour
          ? ['', `This is the last enquiry email this hour. Any more are stored without an email; see them all at ${absoluteUrl('/admin/collections/enquiries')}`]
          : []),
      ].join('\n'),
    })
  } catch (error) {
    payload.logger.error({ err: error, enquiry: enquiry.id }, 'Could not email staff about a new enquiry')
  }
}

const fromSender = { readOnly: true, description: 'As the sender wrote it.' }

export const Enquiries = defineRecord({
  slug: 'enquiries',
  visibility: 'private',
  labels: { singular: 'Enquiry', plural: 'Enquiries' },
  defaultSort: '-createdAt',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'topic', 'status', 'createdAt'],
    description: 'Messages from the contact form. Mark each one handled once someone has replied.',
  },
  indexes: [{ fields: ['senderKey', 'createdAt'] }],
  fields: [
    { name: 'name', type: 'text', required: true, admin: fromSender },
    { name: 'email', type: 'email', required: true, admin: fromSender },
    { name: 'phone', type: 'text', admin: fromSender },
    { name: 'topic', type: 'select', required: true, options: optionsFrom(TOPIC_LABELS), admin: fromSender },
    { name: 'message', type: 'textarea', required: true, admin: fromSender },
    {
      name: 'consent',
      label: 'Agreed to be contacted',
      type: 'checkbox',
      required: true,
      admin: { readOnly: true, position: 'sidebar' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new' satisfies EnquiryStatus,
      options: optionsFrom<EnquiryStatus>({ new: 'New', handled: 'Handled' }),
      admin: { position: 'sidebar' },
    },
    {
      // A keyed hash of the sender's IP address, for the per-sender rate limit. The address itself is never stored.
      name: 'senderKey',
      type: 'text',
      admin: { hidden: true },
    },
  ],
})
