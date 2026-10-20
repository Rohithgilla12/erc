import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The bot checks every public form shares: a signed time token, a per-sender key for rate limits, and the honeypot
 * field name in `form-fields.ts`. Each form signs with its own purpose, so a token or key from one never counts for
 * another.
 */
export type PublicForm = 'enquiry' | 'newsletter'

export type FormTiming = 'ok' | 'too_fast' | 'expired' | 'invalid'

const MIN_FILL_MS = 3_000
const MAX_TOKEN_AGE_MS = 24 * 60 * 60 * 1000

const secret = () => {
  const value = process.env.PAYLOAD_SECRET
  if (!value) throw new Error('PAYLOAD_SECRET is required to sign public forms')
  return value
}

export const mac = (purpose: string, value: string) => createHmac('sha256', secret()).update(`${purpose}:${value}`).digest('base64url')

export const sameMac = (given: string, expected: string) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The time the form was shown, signed so a bot cannot backdate it. */
export const issueFormToken = (form: PublicForm, now: number = Date.now()) => `${now}.${mac(`${form}-form`, String(now))}`

export const checkFormToken = (form: PublicForm, token: string, now: number = Date.now()): FormTiming => {
  const [issued = '', signature = ''] = token.split('.')
  if (!/^\d{13}$/.test(issued) || !sameMac(signature, mac(`${form}-form`, issued))) return 'invalid'
  const age = now - Number(issued)
  if (age < MIN_FILL_MS) return 'too_fast'
  return age > MAX_TOKEN_AGE_MS ? 'expired' : 'ok'
}

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

/** A keyed hash of the sender's network, stored for rate limits. The address itself is never stored. */
export const senderKeyOf = (form: PublicForm, headers: Headers) => mac(`${form}-sender`, senderOf(senderAddress(headers))).slice(0, 32)
