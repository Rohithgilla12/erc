import { ENQUIRY_TOPICS, type EnquiryTopic } from '@erc/domain'
import type { CollectionAfterChangeHook } from 'payload'

import { siteConfig } from '../../site-config'
import { enquiryRecipient } from '../email'
import { optionsFrom } from '../fields'
import { defineRecord } from '../kinds'

type EnquiryStatus = 'new' | 'handled'

const TOPIC_LABELS = Object.fromEntries(ENQUIRY_TOPICS.map(({ key, label }) => [key, label])) as Record<EnquiryTopic, string>

/** Never throws: the enquiry is already stored, and staff see it in the admin whether or not the email goes out. */
const notifyStaff: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  const to = enquiryRecipient()
  if (operation !== 'create' || !to) return doc
  const topic = TOPIC_LABELS[doc.topic as EnquiryTopic] ?? doc.topic
  try {
    await req.payload.sendEmail({
      to,
      replyTo: doc.email,
      subject: `${topic} enquiry from ${doc.name}`,
      text: [
        `${doc.name} <${doc.email}>${doc.phone ? `, ${doc.phone}` : ''}`,
        `Topic: ${topic}`,
        '',
        doc.message,
        '',
        `Reply to this email to answer them, then mark it handled: ${new URL(`/admin/collections/enquiries/${doc.id}`, siteConfig().siteUrl).href}`,
      ].join('\n'),
    })
  } catch (error) {
    req.payload.logger.error({ err: error, enquiry: doc.id }, 'Could not email staff about a new enquiry')
  }
  return doc
}

const fromSender = { readOnly: true, description: 'As the sender wrote it.' }

export const Enquiries = defineRecord({
  slug: 'enquiries',
  // Staff only. The public writes through the contact form's server action, never through this collection's API.
  visibility: 'private',
  labels: { singular: 'Enquiry', plural: 'Enquiries' },
  defaultSort: '-createdAt',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'topic', 'status', 'createdAt'],
    description: 'Messages from the contact form. Mark each one handled once someone has replied.',
  },
  indexes: [{ fields: ['senderKey', 'createdAt'] }],
  hooks: { afterChange: [notifyStaff] },
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
