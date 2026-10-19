import { err, ok, type Email, type Result } from './primitives'

export const ENQUIRY_TOPICS = [
  { key: 'coaching', label: 'Coaching' },
  { key: 'general', label: 'General question' },
  { key: 'partnership', label: 'Partnership' },
  { key: 'race-listing', label: 'Race listing' },
] as const

export type EnquiryTopic = (typeof ENQUIRY_TOPICS)[number]['key']

/** `consent` is the literal `true`: an enquiry the sender did not agree to be contacted about cannot exist. */
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

type FieldResult<T> = Result<T, string>

const firstOf = (raw: unknown): string => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim() : ''
}

const lengthBetween = (raw: string, min: number, max: number, label: string): FieldResult<string> => {
  const length = Array.from(raw).length
  if (length === 0) return err(`Enter ${label}.`)
  return length >= min && length <= max ? ok(raw) : err(`Use ${min} to ${max} characters for ${label}.`)
}

// A name goes into an email subject line, so it is kept to one line.
const name = (raw: string) => lengthBetween(raw.replace(/\s+/g, ' '), 1, 120, 'your name')

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const email = (raw: string): FieldResult<Email> =>
  EMAIL.test(raw) && raw.length <= 254 ? ok(raw as Email) : err('Enter an email address such as name@example.com.')

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

const message = (raw: string) => lengthBetween(raw, 10, 4000, 'your message')

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
  const fields = {
    name: name(field('name')),
    email: email(field('email')),
    phone: phone(field('phone')),
    topic: topic(field('topic')),
    message: message(field('message')),
    consent: consent(field('consent')),
  }
  const errors: Partial<Record<EnquiryField, string>> = {}
  for (const [key, result] of Object.entries(fields) as [EnquiryField, FieldResult<unknown>][]) {
    if (!result.ok) errors[key] = result.error
  }
  const { name: n, email: e, phone: p, topic: t, message: m, consent: c } = fields
  if (!n.ok || !e.ok || !p.ok || !t.ok || !m.ok || !c.ok) return err(errors)
  return ok({ name: n.value, email: e.value, phone: p.value, topic: t.value, message: m.value, consent: c.value })
}
