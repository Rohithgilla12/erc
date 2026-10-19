import { createHmac, timingSafeEqual } from 'node:crypto'

import config from '@payload-config'
import { parseEnquiry, parseEnquiryTopic, type EnquiryErrors, type EnquiryTopic } from '@erc/domain'
import { after } from 'next/server'
import { getPayload } from 'payload'

import { notifyStaffOfEnquiry } from '@/cms/collections/enquiries'

import { HONEYPOT_FIELD, TOKEN_FIELD } from './enquiry-fields'

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

const MIN_FILL_MS = 3_000
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000
const RATE_WINDOW_MS = 60 * 60 * 1000
export const ENQUIRIES_PER_SENDER_PER_HOUR = 5

const secret = () => {
  const value = process.env.PAYLOAD_SECRET
  if (!value) throw new Error('PAYLOAD_SECRET is required to sign the enquiry form')
  return value
}

const mac = (purpose: string, value: string) => createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('base64url')

/** The time the form was shown, signed so a bot cannot backdate it. */
export const issueFormToken = (now: number = Date.now()) => `${now}.${mac('enquiry-form', String(now))}`

const sameMac = (given: string, expected: string) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const checkFormToken = (token: string, now: number = Date.now()): 'ok' | 'too_fast' | 'expired' | 'invalid' => {
  const [issued = '', signature = ''] = token.split('.')
  if (!/^\d{13}$/.test(issued) || !sameMac(signature, mac('enquiry-form', issued))) return 'invalid'
  const age = now - Number(issued)
  if (age < MIN_FILL_MS) return 'too_fast'
  return age > MAX_TOKEN_AGE_MS ? 'expired' : 'ok'
}

export const blankValues = (topic: string | undefined): EnquiryValues => ({
  name: '',
  email: '',
  phone: '',
  topic: parseEnquiryTopic(topic ?? '') ?? '',
  message: '',
  consent: false,
})

export const readyForm = (topic: string | undefined): EnquiryFormState => ({ kind: 'ready', token: issueFormToken(), values: blankValues(topic) })

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
 * The client address as Cloudflare reports it. In production the only way in is the Cloudflare Tunnel, which sets
 * `cf-connecting-ip`; the other headers matter only behind some other proxy or in local runs.
 */
const senderAddress = (headers: Headers) =>
  headers.get('cf-connecting-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? 'unknown'

/** An IPv6 host usually holds a whole /64 and can rotate through it, so the limit counts the /64. */
export const senderOf = (address: string): string => {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped?.[1]) return mapped[1]
  const bare = address.split('%')[0] ?? ''
  if (!bare.includes(':')) return bare
  const [head = '', tail = ''] = bare.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = bare.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

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

  const timing = checkFormToken(token)
  if (timing === 'too_fast') return { kind: 'refused', token, values, reason: 'too_fast' }
  if (timing === 'expired' || timing === 'invalid') return { kind: 'refused', token: issueFormToken(), values, reason: 'expired' }

  const senderKey = mac('enquiry-sender', senderOf(senderAddress(headers))).slice(0, 32)
  const { totalDocs } = await payload.count({
    collection: 'enquiries',
    where: { and: [{ senderKey: { equals: senderKey } }, { createdAt: { greater_than: new Date(Date.now() - RATE_WINDOW_MS).toISOString() } }] },
  })
  if (totalDocs >= ENQUIRIES_PER_SENDER_PER_HOUR) return { kind: 'refused', token, values, reason: 'rate_limited' }

  try {
    const enquiry = await payload.create({
      collection: 'enquiries',
      data: { ...parsed.value, senderKey, status: 'new' },
      // Nothing public reads enquiries, so there is no cached page to expire.
      context: { skipRevalidation: true },
    })
    after(() => notifyStaffOfEnquiry(payload, enquiry))
  } catch (error) {
    payload.logger.error({ err: error }, 'Could not store an enquiry')
    return { kind: 'refused', token, values, reason: 'unavailable' }
  }
  return { kind: 'sent' }
}
