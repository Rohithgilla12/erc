/**
 * Proves member sign-in, the dashboard and the v1 API end to end, driving the forms the way a browser with JavaScript
 * off does: `ERC_CHECK_URL=<site> MAILPIT_URL=<mailpit> pnpm payload run src/scripts/check-members.ts`. The site must
 * share this database and `PAYLOAD_SECRET`, and send mail through the Mailpit instance at `MAILPIT_URL`, whose API this
 * reads the codes from. Mailpit needs STARTTLS and any-auth (`MP_SMTP_TLS_CERT`, `MP_SMTP_TLS_KEY`,
 * `MP_SMTP_AUTH_ACCEPT_ANY=1`); with a self-signed certificate start the site with `NODE_TLS_REJECT_UNAUTHORIZED=0`,
 * for the check only. Everything it writes is removed.
 */
import config from '@payload-config'
import { sql } from '@payloadcms/db-postgres'
import type { Envelope } from '@erc/contract'
import { CLUB_TIME_ZONE, EMAIL_SHARES, SIGN_IN_CODE_MAX_TRIES, SIGN_IN_CODES_PER_ADDRESS_PER_HOUR, SIGN_IN_CODES_PER_SENDER_PER_HOUR, todayIn } from '@erc/domain'
import { getPayload } from 'payload'

const payload = await getPayload({ config })
const site = process.env.ERC_CHECK_URL
const mailpit = process.env.MAILPIT_URL
if (!site || !mailpit) throw new Error('Set ERC_CHECK_URL to the running site and MAILPIT_URL to the Mailpit its SMTP points at')
const run = Date.now()
const failures: string[] = []
const today = todayIn(CLUB_TIME_ZONE)

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const address = (name: string) => `member-check-${run}-${name}@example.com`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const decode = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name.replace(/\$/g, '\\$')}="([^"]*)"`).exec(tag)
  return match ? decode(match[1] ?? '') : null
}

type HtmlForm = { action: string; hidden: Record<string, string> }

/** The first form on the page whose markup contains `marker`, with its action and every hidden input. */
const formWith = (html: string, marker: string): HtmlForm | null => {
  for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)) {
    if (!form.includes(marker)) continue
    const hidden: Record<string, string> = {}
    for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
      const name = attribute(input, 'name')
      if (name && attribute(input, 'type') === 'hidden') hidden[name] = attribute(input, 'value') ?? ''
    }
    return { action: attribute(form.slice(0, form.indexOf('>') + 1), 'action') ?? '', hidden }
  }
  return null
}

const heading = (html: string) => decode(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? '')
/** What a reader sees: no scripts (the RSC payload carries per-request tokens) and no tags. */
const text = (html: string) => decode(html.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')

const SESSION_COOKIE = '__Host-erc_member'

/** One browser: a cookie jar holding the session cookie, and a fixed network address. */
class Browser {
  cookie: string | null = null
  constructor(readonly sender: string) {}

  private headers(extra: Record<string, string> = {}) {
    // Every request also claims a fresh x-forwarded-for, so the per-sender limits only hold if the Cloudflare header wins.
    const headers: Record<string, string> = { 'cf-connecting-ip': this.sender, 'x-forwarded-for': `203.0.113.${run % 250}`, ...extra }
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`
    return headers
  }

  private remember(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = line.split(';')
      const [name, value] = pair.split('=')
      if (name?.trim() !== SESSION_COOKIE) continue
      this.lastSetCookie = { value: value ?? '', attributes: attributes.map((a) => a.trim()) }
      this.cookie = value || null
    }
  }

  lastSetCookie: { value: string; attributes: string[] } | null = null

  withCookie(value: string) {
    this.cookie = value
    return this
  }

  async get(path: string | URL) {
    const response = await fetch(new URL(path, site), { redirect: 'manual', headers: this.headers() })
    this.remember(response)
    return response
  }

  async post(form: HtmlForm, base: string, fields: Record<string, string>) {
    const body = new FormData()
    for (const [name, value] of Object.entries({ ...form.hidden, ...fields })) body.append(name, value)
    const response = await fetch(new URL(form.action || base, new URL(base, site)), { method: 'POST', body, redirect: 'manual', headers: this.headers() })
    this.remember(response)
    return response
  }
}

type MailSummary = { ID: string; Created: string; Subject: string; To: { Address: string }[] }

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

const codeFrom = async (email: string, nth: number) => {
  const mails = await waitForMails(email, nth)
  const mail = mails.sort((a, b) => a.Created.localeCompare(b.Created)).at(nth - 1)
  if (!mail) throw new Error(`No sign-in email ${nth} for ${email}`)
  const message = (await (await fetch(new URL(`/api/v1/message/${mail.ID}`, mailpit))).json()) as { Text: string; Subject: string }
  const code = /\b(\d{6})\b/.exec(message.Text)?.[1]
  if (!code) throw new Error(`No code in the email: ${message.Text}`)
  return { code, subject: message.Subject, body: message.Text }
}

const SIGN_IN_FORM = 'name="email"'
const CODE_FORM = 'name="code"'

/** Step one of the form: ask for a code. Returns the page that came back. */
const askForCode = async (browser: Browser, email: string, extra: Record<string, string> = {}) => {
  const form = formWith(await (await browser.get('/sign-in')).text(), SIGN_IN_FORM)
  if (!form) throw new Error('The sign-in page has no email form; is SMTP configured on the site?')
  return (await browser.post(form, '/sign-in', { step: 'email', email, over18: 'on', website: '', ...extra })).text()
}

/** Step two: type a code into the page step one returned. */
const typeCode = async (browser: Browser, codePage: string, code: string) => {
  const form = formWith(codePage, CODE_FORM)
  if (!form) throw new Error(`The page after asking for a code has no code form: ${heading(codePage)}`)
  return browser.post(form, '/sign-in', { step: 'code', code })
}

const api = async (path: string, init: { method?: string; token?: string | null; cookie?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'cf-connecting-ip': '198.51.100.77' }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(new URL(`/api/v1${path}`, site), {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    redirect: 'manual',
  })
  return { status: response.status, body: (await response.json().catch(() => null)) as Envelope<unknown> | null, cacheControl: response.headers.get('cache-control') }
}

const dashboard = async (token: string) => {
  const reply = await api('/me/dashboard', { token })
  const data = reply.body?.ok ? (reply.body.data as { week: { totals: { distance: number; runs: number } }; month: { totals: { distance: number; runs: number } } }) : null
  return { status: reply.status, week: data?.week.totals ?? null, month: data?.month.totals ?? null }
}

const row = async <T>(query: ReturnType<typeof sql>) => {
  const { rows } = await payload.db.drizzle.execute(query)
  return (rows[0] as T | undefined) ?? null
}
const count = async (query: ReturnType<typeof sql>) => (await row<{ n: number }>(query))?.n ?? 0

const memberRow = (email: string) => row<{ id: number; status: string; age_declared_at: Date | null }>(sql`SELECT id, status, age_declared_at FROM members WHERE email = ${email}`)
const runsOf = (email: string) => count(sql`SELECT count(*)::int AS n FROM activities a JOIN members m ON m.id = a.member_id WHERE m.email = ${email}`)
const sessionsOf = (email: string) => count(sql`SELECT count(*)::int AS n FROM member_sessions s JOIN members m ON m.id = s.member_id WHERE m.email = ${email}`)
const latestCode = (email: string) => row<{ tries: number; closed_at: Date | null }>(sql`SELECT tries, closed_at FROM sign_in_codes WHERE email = ${email} ORDER BY sent_at DESC, id DESC LIMIT 1`)

/** Moves this run's code rows out of the current hour, so a limit case starts from a known count. */
const clearHour = () => payload.db.drizzle.execute(sql`UPDATE sign_in_codes SET sent_at = sent_at - interval '2 hours' WHERE email LIKE ${`member-check-${run}-%`}`)

const staff = await payload.create({ collection: 'staff', data: { email: `member-check-${run}-editor@erc.invalid`, password: `pw-${run}-check`, role: 'editor' } })

try {
  const asha = address('asha')
  const browser = new Browser(`198.51.100.${run % 200}`)

  const home = await (await browser.get('/')).text()
  expect('the header offers sign-in to a visitor', [home.includes('href="/sign-in"'), home.includes('href="/me"')], [true, false])
  const signInPage = await (await browser.get('/sign-in')).text()
  expect('the sign-in page asks for an email and the age declaration', [heading(signInPage), signInPage.includes('name="over18"')], ['Sign in', true])

  const noDeclaration = await (await browser.post(formWith(signInPage, SIGN_IN_FORM)!, '/sign-in', { step: 'email', email: asha, over18: '', website: '' })).text()
  expect('the age declaration is required', text(noDeclaration).includes('Tick the box to confirm you are 18 or over.'), true)
  expect('and nothing is stored or sent without it', [await latestCode(asha), (await mailsTo(asha)).length], [null, 0])

  const codePage = await askForCode(browser, asha.toUpperCase())
  expect('asking for a code shows the code step for the lower-cased address', text(codePage).includes(`We have emailed a six-digit code to ${asha}`), true)
  const first = await codeFrom(asha, 1)
  expect('the email carries the code in its subject and body', first.subject, `${first.code} is your Endurance Run Club sign-in code`)
  const stored = await row<{ code_hash: string; tries: number }>(sql`SELECT code_hash, tries FROM sign_in_codes WHERE email = ${asha}`)
  expect('only a keyed hash of the code is stored', [stored?.code_hash.includes(first.code), stored?.code_hash.length], [false, 43])
  expect('no account exists until the code is typed', await memberRow(asha), null)

  const wrongCode = String((Number(first.code) + 1) % 1_000_000).padStart(6, '0')
  const wrong = await (await typeCode(browser, codePage, wrongCode)).text()
  expect('a wrong code is refused and the code form stays', [text(wrong).includes('That code is not right, or it has expired.'), formWith(wrong, CODE_FORM) !== null], [true, true])
  expect('and counts a try', (await latestCode(asha))?.tries, 1)

  const signedIn = await typeCode(browser, codePage, first.code)
  expect('the right code redirects to /me', [signedIn.status, signedIn.headers.get('location')], [303, '/me'])
  const cookie = browser.lastSetCookie
  expect('and sets a __Host- HttpOnly Secure SameSite=Lax cookie', [cookie?.value.startsWith('erc_'), cookie?.value.length, cookie?.attributes.filter((a) => /^(Path=\/|HttpOnly|Secure|SameSite=lax)$/i.test(a)).length], [true, 47, 4])
  const member = await memberRow(asha)
  expect('an account is created, active, with the age declaration timestamped', [member?.status, member?.age_declared_at instanceof Date || typeof member?.age_declared_at === 'string'], ['active', true])
  expect('the code is used up', (await latestCode(asha))?.closed_at !== null, true)
  const reused = await (await typeCode(new Browser(browser.sender), codePage, first.code)).text()
  expect('typing the same code again is refused', text(reused).includes('That code is not right, or it has expired.'), true)
  const sessionRow = await row<{ token_hash: string; carrier: string }>(sql`SELECT token_hash, carrier FROM member_sessions s JOIN members m ON m.id = s.member_id WHERE m.email = ${asha}`)
  expect('only a SHA-256 of the session token is stored, for the cookie carrier', [sessionRow?.token_hash.length, sessionRow?.token_hash === cookie?.value, sessionRow?.carrier], [64, false, 'cookie'])

  const me = await (await browser.get('/me')).text()
  expect('/me shows the dashboard with nothing logged', [heading(me), text(me).includes('Signed in as ' + asha), text(me).includes('Nothing logged yet')], ['My running', true, true])
  expect('the header now links to My running, not sign-in', [me.includes('href="/me"'), me.includes('href="/sign-in"')], [true, false])
  expect('a signed-in member opening /sign-in is sent to /me', (await browser.get('/sign-in')).headers.get('location'), '/me')

  const runForm = formWith(me, 'name="distanceKm"')
  if (!runForm) throw new Error('/me has no run form')
  const logged = await (await browser.post(runForm, '/me', { date: today, distanceKm: '6.2', duration: '38:10' })).text()
  expect('logging a run from the form saves it and shows this week', [text(logged).includes('Saved: 6.2 km'), /This week.*?6\.2 km.*?1 run\s*,\s*38:10/.test(text(logged))], [true, true])
  const again = await browser.post(runForm, '/me', { date: today, distanceKm: '6.2', duration: '38:10' })
  expect('sending the same form twice logs one run', [again.status, await runsOf(asha)], [200, 1])

  const refused = async (fields: Record<string, string>) => {
    const html = await (await browser.post({ ...runForm, hidden: { ...runForm.hidden, ref: crypto.randomUUID() } }, '/me', fields)).text()
    return /<span class="member-error"[^>]*>([^<]*)</.exec(html)?.[1] ?? 'no field error'
  }
  expect('a run with no time is refused', await refused({ date: today, distanceKm: '5', duration: '' }), 'Enter the time as minutes:seconds, such as 38:10, or hours:minutes:seconds.')
  expect('a pace faster than 2:30 per km is refused', await refused({ date: today, distanceKm: '10', duration: '24:59' }), 'That pace is faster than 2:30 per km. Check the distance and time.')
  expect('over 250 km is refused', await refused({ date: today, distanceKm: '251', duration: '30:00:00' }), 'That is over 250 km. Check the distance.')
  expect('a future date is refused', await refused({ date: '2099-01-01', distanceKm: '5', duration: '30:00' }), 'That date is still to come.')
  expect('none of those were stored', await runsOf(asha), 1)

  const token = cookie!.value
  expect('the cookie token works as a bearer token on /api/v1', await dashboard(token), { status: 200, week: { distance: 6200, moving: 2290, runs: 1 }, month: { distance: 6200, moving: 2290, runs: 1 } })
  const apiRun = await api('/me/runs', { token, body: { date: today, distanceKm: '10', duration: '50:00' } })
  expect('logging a run over the API', [apiRun.status, apiRun.body?.ok, apiRun.cacheControl], [200, true, 'private, no-store'])
  expect('adds to the week total on /me', /This week.*?16\.2 km.*?2 runs/.test(text(await (await browser.get('/me')).text())), true)
  const badRun = await api('/me/runs', { token, body: { date: today, distanceKm: '10', duration: '' } })
  expect('an invalid run over the API gets 422 with field errors', [badRun.status, badRun.body?.ok === false && badRun.body.error.code, badRun.body?.ok === false && Object.keys(badRun.body.error.fields ?? {})], [422, 'invalid', ['duration']])
  const notJson = await api('/me/runs', { token, body: 'not json' })
  expect('a body that is not a JSON object gets 422', [notJson.status, notJson.body?.ok === false && notJson.body.error.code], [422, 'invalid'])

  const memberId = member!.id
  for (let n = 0; n < 25; n += 1) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO activities (member_id, source, ref, on_date, metres, moving_s, logged_at)
      VALUES (${memberId}, 'manual', ${crypto.randomUUID()}, ${today}::date - ${n + 1}::int, 5000, 1800, now() - make_interval(days => ${n + 1}::int))`)
  }
  const pageOne = await api('/me/runs', { token })
  const one = pageOne.body?.ok ? (pageOne.body.data as { items: { ref: string }[]; next: string | null }) : null
  const pageTwo = one?.next ? await api(`/me/runs?after=${encodeURIComponent(one.next)}`, { token }) : null
  const two = pageTwo?.body?.ok ? (pageTwo.body.data as { items: { ref: string }[]; next: string | null }) : null
  const refs = [...(one?.items ?? []), ...(two?.items ?? [])].map((item) => item.ref)
  expect('runs page by cursor, 20 then the rest, with no repeats', [one?.items.length, two?.items.length, two?.next, new Set(refs).size], [20, 7, null, 27])
  const older = await (await browser.get(`/me?after=${encodeURIComponent(one!.next!)}`)).text()
  expect('/me follows the same cursor to older runs', [text(older).includes('Older runs'), (older.match(/class="member-run"/g) ?? []).length], [true, 7])

  const anonymous = await api('/me/dashboard')
  expect('the API refuses a member operation without a bearer token, in the error shape', [anonymous.status, anonymous.body], [401, { ok: false, error: { code: 'unauthenticated', message: 'Sign in to continue.' } }])
  const cookieOnly = await api('/me/dashboard', { cookie: token })
  expect('the API ignores the session cookie', [cookieOnly.status, cookieOnly.body?.ok === false && cookieOnly.body.error.code], [401, 'unauthenticated'])
  const forged = await api('/me/dashboard', { token: 'erc_' + 'A'.repeat(43) })
  expect('a forged bearer token is refused', [forged.status, forged.body?.ok === false && forged.body.error.message], [401, 'That token is not valid. Sign in again.'])
  const missing = await api('/nothing/here')
  expect('an unknown v1 path answers in the v1 error shape, not Payload\'s', [missing.status, missing.body?.ok === false && missing.body.error.code], [404, 'not_found'])
  const payloadShape = await fetch(new URL('/api/nothing/here', site), { headers: { cookie: 'payload-token=forged' } })
  expect('while the same path outside v1 reaches Payload', [payloadShape.status, 'ok' in ((await payloadShape.json().catch(() => ({}))) as object)], [404, false])

  const restWithCookie = await fetch(new URL('/api/members', site), { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
  const restWithBearer = await fetch(new URL('/api/members', site), { headers: { authorization: `Bearer ${token}` } })
  const restMe = (await (await fetch(new URL('/api/staff/me', site), { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).json()) as { user: unknown }
  expect('a member cookie gets nothing from Payload REST, and a member bearer reads as anonymous', [restWithCookie.status, restWithBearer.status, restMe.user], [404, 403, null])
  // Payload's admin answers an anonymous visitor with a 200 unauthorised view and sends them to the login page from the client.
  const adminList = async (headers: Record<string, string>) => {
    const response = await fetch(new URL('/admin/collections/members', site), { headers })
    return { status: response.status, showsMember: (await response.text()).includes(asha) }
  }
  expect('a member cookie does not open /admin', await adminList({ cookie: `${SESSION_COOKIE}=${token}` }), { status: 200, showsMember: false })

  const ben = address('ben')
  const apiStart = await api('/auth/code', { body: { email: ben, over18: true } })
  expect('the API sends a code', [apiStart.status, apiStart.body], [200, { ok: true, data: { sent: true } }])
  const benCode = await codeFrom(ben, 1)
  const apiVerify = await api('/auth/verify', { body: { email: ben, code: benCode.code } })
  const issued = apiVerify.body?.ok ? (apiVerify.body.data as { token: string; expiresAt: string }) : null
  expect('and verifies it into a bearer session that slides 90 days', [apiVerify.status, issued?.token.startsWith('erc_'), Math.round((Date.parse(issued?.expiresAt ?? '') - Date.now()) / 86_400_000)], [200, true, 90])
  expect('which the dashboard accepts', (await dashboard(issued!.token)).status, 200)
  const benSession = await row<{ carrier: string }>(sql`SELECT carrier FROM member_sessions s JOIN members m ON m.id = s.member_id WHERE m.email = ${ben}`)
  expect('recorded against the bearer carrier', benSession?.carrier, 'bearer')

  const chloe = address('chloe')
  const chloeBrowser = new Browser('198.51.100.201')
  const chloePage = await askForCode(chloeBrowser, chloe)
  const chloeCode = await codeFrom(chloe, 1)
  const attempts: string[] = []
  for (let n = 0; n < SIGN_IN_CODE_MAX_TRIES; n += 1) {
    const html = text(await (await typeCode(chloeBrowser, chloePage, wrongCode)).text())
    attempts.push(html.includes('too many wrong tries') ? 'locked' : html.includes('That code is not right') ? 'wrong' : 'other')
  }
  expect('four wrong codes are wrong, the fifth locks the code', attempts, ['wrong', 'wrong', 'wrong', 'wrong', 'locked'])
  const afterLock = text(await (await typeCode(chloeBrowser, chloePage, chloeCode.code)).text())
  expect('the right code is refused once locked, and no account was created', [afterLock.includes('too many wrong tries'), await memberRow(chloe), (await latestCode(chloe))?.tries], [true, null, 5])
  const renewed = await askForCode(chloeBrowser, chloe)
  expect('asking again inside a minute resends nothing, and the locked code stays locked', [formWith(renewed, CODE_FORM) !== null, (await mailsTo(chloe)).length], [true, 1])

  const probe = new Browser('198.51.100.202')
  const unknown = address('nobody')
  const forMember = text(await askForCode(probe, asha)).replace(asha, '<address>')
  const forUnknown = text(await askForCode(probe, unknown)).replace(unknown, '<address>')
  expect('the reply to a code request is the same for a member and an unknown address', forMember === forUnknown, true)
  const memberWrong = text(await (await typeCode(probe, await askForCode(probe, asha), wrongCode)).text()).replace(asha, '<address>')
  const unknownWrong = text(await (await typeCode(probe, await askForCode(probe, unknown), wrongCode)).text()).replace(unknown, '<address>')
  const neverAsked = await api('/auth/verify', { body: { email: address('never'), code: '123456' } })
  const memberWrongApi = await api('/auth/verify', { body: { email: asha, code: wrongCode } })
  expect('and so is the reply to a wrong code, on the web and over the API, even for an address that never asked', [memberWrong === unknownWrong, neverAsked.body, memberWrongApi.body], [
    true,
    { ok: false, error: { code: 'forbidden', message: 'That code is not right, or it has expired. Check the email, or ask for a new code.' } },
    { ok: false, error: { code: 'forbidden', message: 'That code is not right, or it has expired. Check the email, or ask for a new code.' } },
  ])
  expect('a code was emailed to the unknown address too', (await waitForMails(unknown, 1)).length, 1)

  await clearHour()
  const dev = address('dev')
  const devBrowser = new Browser('198.51.100.203')
  const perAddress: boolean[] = []
  for (let n = 0; n <= SIGN_IN_CODES_PER_ADDRESS_PER_HOUR; n += 1) {
    perAddress.push(text(await askForCode(devBrowser, dev)).includes('We have sent several codes to this address'))
    await payload.db.drizzle.execute(sql`UPDATE sign_in_codes SET sent_at = sent_at - interval '2 minutes' WHERE email = ${dev}`)
  }
  expect('an address gets three codes an hour, then is told so', perAddress, [false, false, false, true])
  expect('and exactly three emails', (await mailsTo(dev)).length, SIGN_IN_CODES_PER_ADDRESS_PER_HOUR)

  await clearHour()
  const busy = new Browser('198.51.100.204')
  const perSender: boolean[] = []
  for (let n = 0; n <= SIGN_IN_CODES_PER_SENDER_PER_HOUR; n += 1) {
    perSender.push(text(await askForCode(busy, address(`busy-${n}`))).includes('several sign-in requests from your connection'))
  }
  expect(`a sender gets ${SIGN_IN_CODES_PER_SENDER_PER_HOUR} code requests an hour, then is refused`, perSender, [...Array<boolean>(SIGN_IN_CODES_PER_SENDER_PER_HOUR).fill(false), true])

  await clearHour()
  const share = EMAIL_SHARES.sign_in_code - (await count(sql`SELECT count(*)::int AS n FROM sign_in_codes WHERE sent_at > now() - interval '1 hour'`))
  if (share <= 0) throw new Error('Other sign-in codes fill this hour, so the share check cannot measure it; run it again later')
  for (let n = 0; n < share; n += 1) {
    await payload.db.drizzle.execute(
      sql`INSERT INTO sign_in_codes (email, code_hash, sender_key, sent_at, expires_at) VALUES (${address(`filler-${n}`)}, 'filler', 'filler', now(), now() + interval '10 minutes')`,
    )
  }
  const pastShare = text(await askForCode(new Browser('198.51.100.205'), address('past-share')))
  expect('past the hourly share nobody is sent a code, and the reply says to try later', [pastShare.includes('We cannot send sign-in codes just now'), (await mailsTo(address('past-share'))).length], [true, 0])
  const pastShareApi = await api('/auth/code', { body: { email: address('past-share-api'), over18: true } })
  expect('the API says the same with 503', [pastShareApi.status, pastShareApi.body?.ok === false && pastShareApi.body.error.code], [503, 'unavailable'])
  await clearHour()

  const signOutForm = formWith(await (await browser.get('/me')).text(), 'class="member-signout"')
  if (!signOutForm) throw new Error('/me has no sign-out form')
  const signedOut = await browser.post(signOutForm, '/me', {})
  expect('signing out redirects home and clears the cookie', [signedOut.status, signedOut.headers.get('location'), browser.lastSetCookie?.value, browser.lastSetCookie?.attributes.some((a) => /^Expires=Thu, 01 Jan 1970/.test(a))], [303, '/', '', true])
  expect('the old cookie no longer opens /me', (await new Browser(browser.sender).withCookie(token).get('/me')).headers.get('location'), '/sign-in')
  expect('and the same token is refused as a bearer', (await dashboard(token)).status, 401)
  expect('because the session row is gone', await sessionsOf(asha), 0)

  const ashaMails = async () => (await mailsTo(asha)).length
  let sent = await ashaMails()
  const again2 = await api('/auth/code', { body: { email: asha, over18: true } })
  expect('the member signs in again over the API', again2.body, { ok: true, data: { sent: true } })
  const ashaAgain = await codeFrom(asha, (sent += 1))
  const reissued = (await api('/auth/verify', { body: { email: asha, code: ashaAgain.code } })).body
  const bearerAgain = reissued?.ok ? (reissued.data as { token: string }).token : ''
  const webAgain = new Browser(browser.sender)
  const webAgainPage = await askForCode(webAgain, asha)
  await typeCode(webAgain, webAgainPage, (await codeFrom(asha, (sent += 1))).code)
  expect('and on the web, holding two sessions', [bearerAgain.startsWith('erc_'), webAgain.cookie?.startsWith('erc_'), await sessionsOf(asha)], [true, true, 2])

  const login = await fetch(new URL('/api/staff/login', site), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: staff.email, password: `pw-${run}-check` }) })
  const { token: jwt } = (await login.json()) as { token: string }
  const asStaff = { authorization: `JWT ${jwt}`, 'content-type': 'application/json' }
  const listed = (await (await fetch(new URL(`/api/members?where[email][equals]=${encodeURIComponent(asha)}`, site), { headers: asStaff })).json()) as { docs: { id: number; email: string }[] }
  expect('staff read members in Payload', listed.docs.map((doc) => doc.email), [asha])
  expect('and see them in /admin', await adminList({ cookie: `payload-token=${jwt}` }), { status: 200, showsMember: true })
  const renamed = await fetch(new URL(`/api/members/${memberId}`, site), { method: 'PATCH', headers: asStaff, body: JSON.stringify({ email: address('renamed'), ageDeclaredAt: '2000-01-01T00:00:00.000Z' }) })
  const afterRename = await memberRow(asha)
  expect('but cannot change an email or the age declaration', [renamed.status, afterRename?.id, String(afterRename?.age_declared_at) === String(member?.age_declared_at)], [200, memberId, true])
  const created = await fetch(new URL('/api/members', site), { method: 'POST', headers: asStaff, body: JSON.stringify({ email: address('staff-made'), ageDeclaredAt: new Date().toISOString() }) })
  expect('and cannot create a member', created.status, 403)
  const suspended = await fetch(new URL(`/api/members/${memberId}`, site), { method: 'PATCH', headers: asStaff, body: JSON.stringify({ status: 'suspended' }) })
  expect('staff can suspend a member', [suspended.status, (await memberRow(asha))?.status], [200, 'suspended'])
  expect('which ends both sessions', [await sessionsOf(asha), (await webAgain.get('/me')).headers.get('location'), (await dashboard(bearerAgain)).status], [0, '/sign-in', 401])
  await api('/auth/code', { body: { email: asha, over18: true } })
  const suspendedVerify = await api('/auth/verify', { body: { email: asha, code: (await codeFrom(asha, (sent += 1))).code } })
  expect('and refuses the suspended member a new session even with the right code', [suspendedVerify.status, suspendedVerify.body?.ok === false && suspendedVerify.body.error.message], [
    403,
    'This account is suspended. Contact the club if you think that is a mistake.',
  ])
} finally {
  await payload.db.drizzle.execute(sql`DELETE FROM members WHERE email LIKE ${`member-check-${run}-%`}`)
  await payload.db.drizzle.execute(sql`DELETE FROM sign_in_codes WHERE email LIKE ${`member-check-${run}-%`}`)
  await payload.delete({ collection: 'staff', id: staff.id })
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('All member checks passed')
process.exit(0)
