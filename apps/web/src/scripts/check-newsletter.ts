/**
 * Proves the newsletter flow end to end, posting the forms the way a browser with JavaScript off does:
 * `ERC_CHECK_URL=<site> MAILPIT_URL=<mailpit> pnpm payload run src/scripts/check-newsletter.ts`. The site must share
 * this database and `PAYLOAD_SECRET`, and send mail through the Mailpit instance at `MAILPIT_URL`, whose API this reads
 * the confirmation emails from. Everything it writes is removed.
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

import { FORGED_SESSION } from './fixtures/forged-session'

const payload = await getPayload({ config })
const site = process.env.ERC_CHECK_URL
const mailpit = process.env.MAILPIT_URL
if (!site || !mailpit) throw new Error('Set ERC_CHECK_URL to the running site and MAILPIT_URL to the Mailpit its SMTP points at')
const run = Date.now()
const failures: string[] = []
const addresses = new Set<string>()

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const address = (name: string) => {
  const email = `newsletter-check-${run}-${name}@example.com`
  addresses.add(email)
  return email
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const decode = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name.replace(/\$/g, '\\$')}="([^"]*)"`).exec(tag)
  return match ? decode(match[1] ?? '') : null
}

type HtmlForm = { action: string; hidden: Record<string, string> }

/** The first form on the page that has a field with this name, with its action and every hidden input. */
const formWith = (html: string, field: string): HtmlForm | null => {
  for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    if (!form.includes(`name="${field}"`)) continue
    const hidden: Record<string, string> = {}
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      const name = attribute(input, 'name')
      if (name && attribute(input, 'type') === 'hidden') hidden[name] = attribute(input, 'value') ?? ''
    }
    return { action: attribute(form.slice(0, form.indexOf('>') + 1), 'action') ?? '', hidden }
  }
  return null
}

const fromSender = (sender: string) => ({ 'cf-connecting-ip': sender })

const get = (path: string | URL, sender = '198.51.100.1') => fetch(new URL(path, site), { redirect: 'manual', headers: fromSender(sender) })

const post = (form: HtmlForm, base: string | URL, fields: Record<string, string>, sender: string) => {
  const body = new FormData()
  for (const [name, value] of Object.entries({ ...form.hidden, ...fields })) body.append(name, value)
  return fetch(new URL(form.action || base, new URL(base, site)), { method: 'POST', body, redirect: 'manual', headers: fromSender(sender) })
}

/** A freshly served footer form, aged past the minimum fill time. */
const footerForm = async (sender: string, { wait = true } = {}) => {
  const form = formWith(await (await get('/', sender)).text(), 'email')
  if (!form) throw new Error('The footer has no newsletter form; is SMTP configured on the site?')
  if (wait) await sleep(3_100)
  return form
}

const signUp = async (form: HtmlForm, email: string, sender: string, extra: Record<string, string> = {}) => {
  const response = await post(form, '/', { email, website: '', ...extra }, sender)
  const html = await response.text()
  if (html.includes('Check your inbox')) return 'sent'
  const alert = /id="newsletter-message"[^>]*>([^<]*)</.exec(html)?.[1]
  return alert ? decode(alert) : `HTTP ${response.status}`
}

const subscriberRow = async (email: string) => {
  const { rows } = await payload.db.drizzle.execute(
    sql`SELECT status, source, consented_at, confirmed_at, confirm_token_hash, confirm_expires_at, sender_key FROM subscribers WHERE email = ${email}`,
  )
  return (rows[0] as Record<string, unknown> | undefined) ?? null
}

type MailSummary = { ID: string; To: { Address: string }[] }

const mailsTo = async (email: string): Promise<MailSummary[]> => {
  const response = await fetch(new URL(`/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, mailpit))
  return ((await response.json()) as { messages: MailSummary[] }).messages
}

const waitForMails = async (email: string, count: number) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mails = await mailsTo(email)
    if (mails.length >= count) return mails
    await sleep(250)
  }
  return mailsTo(email)
}

const linksIn = async (mail: MailSummary) => {
  const message = (await (await fetch(new URL(`/api/v1/message/${mail.ID}`, mailpit))).json()) as { Text: string; Subject: string }
  const confirm = /(\S+\/newsletter\/confirm\?token=\S+)/.exec(message.Text)?.[1]
  const unsubscribe = /(\S+\/newsletter\/unsubscribe\?token=\S+)/.exec(message.Text)?.[1]
  if (!confirm || !unsubscribe) throw new Error(`No links in the email: ${message.Text}`)
  return { subject: message.Subject, confirm: new URL(confirm), unsubscribe: new URL(unsubscribe) }
}

/** Opens a link from an email and presses its button, as a person without JavaScript would. */
const pressButton = async (link: URL, sender: string) => {
  const page = await (await get(link, sender)).text()
  const form = formWith(page, 'token')
  if (!form) return { page, location: null }
  const response = await post(form, link, {}, sender)
  return { page, location: response.headers.get('location') }
}

const heading = (html: string) => decode(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? '')

const staff = await payload.create({
  collection: 'staff',
  data: { email: `newsletter-check-${run}@erc.invalid`, password: `pw-${run}-check`, role: 'editor' },
})

try {
  const sender = `198.51.100.${run % 200}`
  const form = await footerForm(sender)
  expect('the footer form posts to /newsletter when JavaScript is off', form.action, '/newsletter#newsletter')

  const asha = address('asha')
  expect('a signup is accepted', await signUp(form, asha.toUpperCase(), sender), 'sent')
  const pending = await subscriberRow(asha)
  expect('the address is stored lower-cased and pending, from the footer', [pending?.status, pending?.source], ['pending', 'site-footer'])
  expect('only a 64-character hash of the confirmation token is stored', String(pending?.confirm_token_hash).length, 64)
  expect('no client address is stored, only a keyed hash', String(pending?.sender_key).includes(sender), false)

  const [mail] = await waitForMails(asha, 1)
  if (!mail) throw new Error('No confirmation email arrived')
  const links = await linksIn(mail)
  expect('the email asks to confirm', links.subject, 'Confirm your Endurance Run Club newsletter signup')
  expect('the emailed link carries a token, never the address', links.confirm.href.includes('example.com'), false)

  const opened = await (await get(links.confirm, sender)).text()
  expect('opening the confirmation link only shows a button', heading(opened), 'Confirm your subscription')
  expect('opening the link does not confirm', (await subscriberRow(asha))?.status, 'pending')

  const confirmed = await pressButton(links.confirm, sender)
  expect('confirming redirects to the success page', confirmed.location, '/newsletter/confirm?status=confirmed')
  const row = await subscriberRow(asha)
  expect('confirming marks the subscriber confirmed, timestamps it, and clears the token', [row?.status, row?.confirmed_at !== null, row?.confirm_token_hash], [
    'confirmed',
    true,
    null,
  ])
  expect('the success page says so', heading(await (await get('/newsletter/confirm?status=confirmed')).text()), 'You are subscribed')

  const reused = await pressButton(links.confirm, sender)
  expect('a used confirmation link shows no button', [heading(reused.page), reused.location], ['This link has been used or is not valid', null])

  const again = await footerForm(sender)
  expect('signing up a confirmed address gives the same reply', await signUp(again, asha, sender), 'sent')
  const unchanged = await subscriberRow(asha)
  expect('and changes nothing', [unchanged?.status, String(unchanged?.consented_at)], ['confirmed', String(row?.consented_at)])
  await sleep(1_000)
  expect('and sends no second email', (await mailsTo(asha)).length, 1)

  const left = await pressButton(links.unsubscribe, sender)
  expect('opening the unsubscribe link shows a button', heading(left.page), 'Unsubscribe from the newsletter')
  expect('unsubscribing redirects to the done page', left.location, '/newsletter/unsubscribe?status=done')
  expect('the subscriber is unsubscribed', (await subscriberRow(asha))?.status, 'unsubscribed')
  expect('unsubscribing twice ends in the same place', (await pressButton(links.unsubscribe, sender)).location, '/newsletter/unsubscribe?status=done')
  const tampered = new URL(links.unsubscribe)
  tampered.searchParams.set('token', `${tampered.searchParams.get('token')?.split('.')[0]}.forged`)
  expect('a forged unsubscribe link is refused', heading(await (await get(tampered, sender)).text()), 'This unsubscribe link is not valid')

  expect('signing up again after unsubscribing is accepted', await signUp(again, asha, sender), 'sent')
  expect('it asks for confirmation again rather than resubscribing silently', (await subscriberRow(asha))?.status, 'pending')
  expect('with a new email', (await waitForMails(asha, 2)).length, 2)
  expect('a repeat inside the resend window gives the same reply', await signUp(again, asha, sender), 'sent')
  await sleep(1_000)
  expect('but sends no third email', (await mailsTo(asha)).length, 2)

  const ben = address('ben')
  expect('a second address signs up', await signUp(again, ben, sender), 'sent')
  const [benMail] = await waitForMails(ben, 1)
  if (!benMail) throw new Error('No confirmation email arrived for the second address')
  const benLinks = await linksIn(benMail)
  await payload.db.drizzle.execute(sql`UPDATE subscribers SET confirm_expires_at = now() - interval '1 second' WHERE email = ${ben}`)
  const expired = await pressButton(benLinks.confirm, sender)
  expect('an expired link shows no button', [heading(expired.page), expired.location], ['This link has expired', null])
  const forcedPost = await post({ action: '', hidden: formWith(opened, 'token')?.hidden ?? {} }, benLinks.confirm, { token: benLinks.confirm.searchParams.get('token') ?? '' }, sender)
  expect('posting an expired token does not confirm', [forcedPost.headers.get('location')?.includes('status=confirmed'), (await subscriberRow(ben))?.status], [false, 'pending'])

  const bot = address('bot')
  expect('a filled honeypot gets the same reply', await signUp(again, bot, sender, { website: 'https://spam.example' }), 'sent')
  expect('and stores nothing', await subscriberRow(bot), null)

  const hasty = await footerForm(sender, { wait: false })
  expect('a form sent within three seconds is refused', await signUp(hasty, address('hasty'), sender), 'That was quicker than we expect from a person. Please send it again.')

  expect('an invalid address is refused with a field error', await signUp(again, 'not-an-address', sender), 'Enter an email address such as name@example.com.')

  const busySender = `198.51.100.${200 + (run % 50)}`
  const busy = await footerForm(busySender)
  const outcomes = []
  for (let n = 0; n < 6; n += 1) outcomes.push(await signUp(busy, address(`busy-${n}`), busySender))
  expect('a sender gets five signups an hour, then is refused', outcomes, [
    'sent',
    'sent',
    'sent',
    'sent',
    'sent',
    'We have had several signups from your connection in the last hour. Please try again later.',
  ])

  await payload.db.drizzle.execute(sql`UPDATE subscribers SET status = 'confirmed', confirmed_at = now() WHERE email = ${ben}`)
  const probeSender = `198.51.100.${250 + (run % 5)}`
  const probe = await footerForm(probeSender)
  const probed = []
  for (const email of [address('probe-0'), address('probe-1'), address('probe-2'), address('probe-3'), ben, address('probe-4')]) {
    probed.push(await signUp(probe, email, probeSender))
  }
  expect('a listed address uses up the limit like a new one, so the limit cannot probe the list', probed.slice(4), [
    'sent',
    'We have had several signups from your connection in the last hour. Please try again later.',
  ])

  const stale = address('stale')
  const kept = address('kept')
  await payload.db.drizzle.execute(sql`
    INSERT INTO subscribers (email, status, source, consented_at, confirmed_at)
    VALUES (${stale}, 'pending', 'site-footer', now() - interval '31 days', NULL),
           (${kept}, 'confirmed', 'site-footer', now() - interval '31 days', now() - interval '31 days')`)
  expect('another signup goes through', await signUp(again, address('trigger'), sender), 'sent')
  expect('an address left unconfirmed for 30 days is deleted, a confirmed one is kept', [await subscriberRow(stale), (await subscriberRow(kept))?.status], [
    null,
    'confirmed',
  ])

  // Past the API gate as an anonymous reader, so the collection's own access rules answer.
  const anonymous = await Promise.all(
    [
      fetch(new URL('/api/subscribers', site), { headers: FORGED_SESSION }),
      fetch(new URL('/api/subscribers/export.csv', site), { headers: FORGED_SESSION }),
      fetch(new URL('/api/subscribers', site), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', ...FORGED_SESSION } }),
    ].map(async (response) => (await response).status),
  )
  expect('anonymous REST reads, exports and creates are refused', anonymous, [403, 403, 403])

  const login = await fetch(new URL('/api/staff/login', site), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: staff.email, password: `pw-${run}-check` }),
  })
  const { token } = (await login.json()) as { token: string }
  const csv = await fetch(new URL('/api/subscribers/export.csv', site), { headers: { authorization: `JWT ${token}` } })
  const lines = (await csv.text()).trim().split('\r\n')
  expect('staff download a CSV', [csv.status, csv.headers.get('content-type'), lines[0]], [200, 'text/csv; charset=utf-8', 'email,confirmed_at,consented_at,source'])
  expect('it lists confirmed subscribers only', lines.filter((line) => line.includes(`newsletter-check-${run}`)).map((line) => line.split(',')[0]).sort(), [ben, kept].sort())
  const staffCreate = await fetch(new URL('/api/subscribers', site), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `JWT ${token}` },
    body: JSON.stringify({ email: address('staff-added'), consentedAt: new Date().toISOString() }),
  })
  expect('staff cannot add a subscriber who never confirmed', staffCreate.status, 403)
} finally {
  await payload.db.drizzle.execute(sql`DELETE FROM subscribers WHERE email LIKE ${`newsletter-check-${run}-%`}`)
  await payload.delete({ collection: 'staff', id: staff.id })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('All newsletter checks passed')
process.exit(0)
