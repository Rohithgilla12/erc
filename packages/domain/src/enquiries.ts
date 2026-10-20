import { collect, email, firstOf, textBetween, type FieldResult } from './form-fields'
import { err, ok, type Email, type Result } from './primitives'

export const ENQUIRY_TOPICS = [
  { key: 'coaching', label: 'Coaching' },
  { key: 'general', label: 'General question' },
  { key: 'partnership', label: 'Partnership' },
  { key: 'race-listing', label: 'Race listing' },
] as const

export type EnquiryTopic = (typeof ENQUIRY_TOPICS)[number]['key']

export type Enquiry = {
  name: string
  email: Email
  phone: string | null
  topic: EnquiryTopic
  message: string
  consent: true
}

export type EnquiryField = keyof Enquiry
export type EnquiryErrors = Readonly<Partial<Record<EnquiryField, string>>>

export const parseEnquiryTopic = (raw: string): EnquiryTopic | null => ENQUIRY_TOPICS.find((topic) => topic.key === raw)?.key ?? null

// A name goes into an email subject line, so it is kept to one line.
const name = (raw: string) => textBetween(raw.replace(/\s+/g, ' '), 1, 120, 'your name')

const PHONE = /^\+?[\d\s().-]+$/
const phone = (raw: string): FieldResult<string | null> => {
  if (raw === '') return ok(null)
  const digits = raw.replace(/\D/g, '').length
  return PHONE.test(raw) && digits >= 7 && digits <= 15 ? ok(raw.replace(/\s+/g, ' ')) : err('Enter a phone number such as +91 98765 43210, or leave it empty.')
}

const topic = (raw: string): FieldResult<EnquiryTopic> => {
  const known = parseEnquiryTopic(raw)
  return known ? ok(known) : err('Choose what your message is about.')
}

const message = (raw: string) => textBetween(raw, 10, 4000, 'your message')

const consent = (raw: string): FieldResult<true> =>
  ['on', 'true', '1'].includes(raw) ? ok(true) : err('Tick the box so we may reply to you.')

/**
 * Takes plain fields, not `FormData`, so the web form and a future mobile client share it. Each field is a string or
 * string array; the first value is used, trimmed. Errors are keyed by field name.
 *
 * Required: `name` (1 to 120 characters, whitespace collapsed), `email`, `topic` (a key of `ENQUIRY_TOPICS`),
 * `message` (10 to 4000 characters), `consent` (`on`, `true` or `1`). Optional: `phone` (7 to 15 digits, with
 * spaces, brackets, dots, hyphens and a leading `+` allowed).
 */
export const parseEnquiry = (input: Readonly<Record<string, unknown>>): Result<Enquiry, EnquiryErrors> => {
  const field = (key: EnquiryField) => firstOf(input[key])
  const fields = collect({
    name: name(field('name')),
    email: email(field('email')),
    phone: phone(field('phone')),
    topic: topic(field('topic')),
    message: message(field('message')),
    consent: consent(field('consent')),
  })
  return fields.ok ? ok(fields.value) : err(fields.error as EnquiryErrors)
}
