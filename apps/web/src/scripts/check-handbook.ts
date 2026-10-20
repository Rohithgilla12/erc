/**
 * Proves the admin handbook is for staff only and renders inside the admin:
 * `ERC_CHECK_URL=http://localhost:3000 pnpm payload run src/scripts/check-handbook.ts`. It signs in as a throwaway
 * author, which it deletes afterwards.
 */
import config from '@payload-config'
import { randomBytes } from 'node:crypto'
import { getPayload } from 'payload'

import { HANDBOOK_HREF } from '@/cms/components/handbook/handbook-path'

const site = process.env.ERC_CHECK_URL ?? ''
if (!site) throw new Error('Set ERC_CHECK_URL to a running site, such as http://localhost:3000')

const payload = await getPayload({ config })
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

// The admin layout has already streamed by the time the view runs, so Next sends the redirect inside a 200 response,
// as it does for Payload's own views. What matters is that none of the handbook is in it. The page title names the
// handbook either way, so the check looks for a phrase from its body.
const BODY_TEXT = 'Who can do what'
const anonymous = await (await fetch(new URL(HANDBOOK_HREF, site), { redirect: 'manual' })).text()
expect('an anonymous visitor gets none of the handbook', anonymous.includes(BODY_TEXT), false)
expect('an anonymous visitor is sent to the login page', anonymous.includes(`/admin/login?redirect=${encodeURIComponent(HANDBOOK_HREF)}`), true)

const email = `handbook-check-${Date.now()}@example.invalid`
const password = randomBytes(18).toString('base64url')
const author = await payload.create({ collection: 'staff', data: { email, password, role: 'author' } })

try {
  const login = await fetch(new URL('/api/staff/login', site), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const { token } = (await login.json()) as { token?: string }
  expect('the throwaway author signs in', login.status, 200)

  const page = await fetch(new URL(HANDBOOK_HREF, site), { headers: { cookie: `payload-token=${token}` }, redirect: 'manual' })
  const html = await page.text()
  expect('an author can open the handbook', page.status, 200)
  expect('the handbook renders', html.includes(BODY_TEXT), true)
  expect('it sits inside the admin with its menu link', html.includes(`href="${HANDBOOK_HREF}"`) && html.includes('nav__link'), true)

  const dashboard = await fetch(new URL('/admin', site), { headers: { cookie: `payload-token=${token}` } })
  expect('the dashboard points new staff to the handbook', (await dashboard.text()).includes('Read the admin handbook'), true)
} finally {
  await payload.delete({ collection: 'staff', id: author.id })
}

if (failures.length) {
  console.error(`${failures.length} check(s) failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('handbook checks passed')
process.exit(0)
