import config from '@payload-config'
import { parseEnquiry, parseEnquiryTopic, type EnquiryErrors, type EnquiryTopic } from '@erc/domain'
import { after } from 'next/server'
import { getPayload } from 'payload'

import { notifyStaffOfEnquiry } from '@/cms/collections/enquiries'

import { HONEYPOT_FIELD, TOKEN_FIELD } from './form-fields'
import { checkFormToken, issueFormToken, senderKeyOf } from './form-guard'

export type EnquiryValues = { name: string; email: string; phone: string; topic: EnquiryTopic | ''; message: string; consent: boolean }

export type EnquiryRefusal = 'too_fast' | 'expired' | 'rate_limited' | 'unavailable'

/**
 * `token` travels with every state that shows the form, so the form shown again after a refusal keeps the time it was
 * first shown rather than restarting the clock.
 */
export type EnquiryFormState =
  | { kind: 'ready'; token: string; values: EnquiryValues }
  | { kind: 'invalid'; token: string; values: EnquiryValues; errors: EnquiryErrors }
  | { kind: 'refused'; token: string; values: EnquiryValues; reason: EnquiryRefusal }
  | { kind: 'sent' }

const RATE_WINDOW_MS = 60 * 60 * 1000
export const ENQUIRIES_PER_SENDER_PER_HOUR = 5

/**
 * Staff emails about new enquiries, site-wide, in any hour. Every accepted enquiry is still stored and listed in the
 * admin; past the cap only the email is skipped, until the hour's count falls below it. A club gets a few enquiries a
 * day, so five in an hour is already unusual, and it leaves the shared relay (about 500 messages a day) room for
 * `NEWSLETTER_CONFIRMATIONS_PER_HOUR`: together they stay under it even if both forms are flooded all day.
 */
export const STAFF_EMAILS_PER_HOUR = 5

export const blankValues = (topic: string | undefined): EnquiryValues => ({
  name: '',
  email: '',
  phone: '',
  topic: parseEnquiryTopic(topic ?? '') ?? '',
  message: '',
  consent: false,
})

export const readyForm = (topic: string | undefined): EnquiryFormState => ({ kind: 'ready', token: issueFormToken('enquiry'), values: blankValues(topic) })

const text = (fields: Readonly<Record<string, string>>, key: string) => fields[key] ?? ''

const valuesOf = (fields: Readonly<Record<string, string>>): EnquiryValues => ({
  name: text(fields, 'name'),
  email: text(fields, 'email'),
  phone: text(fields, 'phone'),
  topic: parseEnquiryTopic(text(fields, 'topic')) ?? '',
  message: text(fields, 'message'),
  consent: text(fields, 'consent') !== '',
})

/**
 * The public intake for enquiries. The rate limit counts this sender's stored enquiries, so it survives restarts and
 * needs no table of its own, and refused attempts cost nothing to count. Two submissions racing past the count can
 * each get through, which a contact form can live with.
 */
export async function receiveEnquiry(fields: Readonly<Record<string, string>>, headers: Headers): Promise<EnquiryFormState> {
  const token = text(fields, TOKEN_FIELD)
  const values = valuesOf(fields)
  const payload = await getPayload({ config })

  // Told it worked, so a bot learns nothing. Logged as a warning in case autofill ever catches a person.
  if (text(fields, HONEYPOT_FIELD) !== '') {
    payload.logger.warn('Dropped an enquiry that filled the hidden field')
    return { kind: 'sent' }
  }

  const parsed = parseEnquiry(fields)
  if (!parsed.ok) return { kind: 'invalid', token, values, errors: parsed.error }

  const timing = checkFormToken('enquiry', token)
  if (timing === 'too_fast') return { kind: 'refused', token, values, reason: 'too_fast' }
  if (timing === 'expired' || timing === 'invalid') return { kind: 'refused', token: issueFormToken('enquiry'), values, reason: 'expired' }

  const senderKey = senderKeyOf('enquiry', headers)
  const windowStart = { greater_than: new Date(Date.now() - RATE_WINDOW_MS).toISOString() }
  const { totalDocs } = await payload.count({
    collection: 'enquiries',
    where: { and: [{ senderKey: { equals: senderKey } }, { createdAt: windowStart }] },
  })
  if (totalDocs >= ENQUIRIES_PER_SENDER_PER_HOUR) return { kind: 'refused', token, values, reason: 'rate_limited' }

  try {
    const earlier = (await payload.count({ collection: 'enquiries', where: { createdAt: windowStart } })).totalDocs
    const enquiry = await payload.create({
      collection: 'enquiries',
      data: { ...parsed.value, senderKey, status: 'new' },
      // Nothing public reads enquiries, so there is no cached page to expire.
      context: { skipRevalidation: true },
    })
    if (earlier < STAFF_EMAILS_PER_HOUR) {
      after(() => notifyStaffOfEnquiry(payload, enquiry, { lastThisHour: earlier + 1 === STAFF_EMAILS_PER_HOUR }))
    } else {
      payload.logger.warn({ enquiry: enquiry.id, cap: STAFF_EMAILS_PER_HOUR }, 'Stored an enquiry without emailing staff: the hourly email cap is reached')
    }
  } catch (error) {
    payload.logger.error({ err: error }, 'Could not store an enquiry')
    return { kind: 'refused', token, values, reason: 'unavailable' }
  }
  return { kind: 'sent' }
}
