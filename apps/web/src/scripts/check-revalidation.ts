/**
 * Proves a Local API write from outside the server refreshes the running site's cached race pages:
 * start the site, then `pnpm payload run src/scripts/check-revalidation.ts`. Needs ERC_SITE_URL and REVALIDATE_SECRET.
 * The race it renames gets its name back.
 */
import config from '@payload-config'
import { parseRaceQuery, todayIn } from '@erc/domain'
import { getPayload } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'
import { queryRaces } from '@/content/races'

const site = process.env.ERC_SITE_URL
if (!site) throw new Error('Set ERC_SITE_URL to the running site')

const payload = await getPayload({ config })
const failures: string[] = []

const expect = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const html = async (path: string) => {
  const response = await fetch(new URL(path, site))
  return (await response.text()).replaceAll('&amp;', '&')
}

const today = todayIn('Asia/Kolkata')
const [race] = (await queryRaces(payload, parseRaceQuery({}, today), today)).races
if (!race) throw new Error('No approved upcoming race to rename; seed first')

const detailPath = `/races/${race.slug}`
const listPath = '/races'
const renamed = `${race.name} renamed ${Date.now()}`

const showsName = async (name: string) => ({ detail: (await html(detailPath)).includes(name), list: (await html(listPath)).includes(name) })

const before = await showsName(race.name)
expect(`${detailPath} and ${listPath} show "${race.name}" before the change`, before.detail && before.list)

try {
  const unannounced = `${renamed} unannounced`
  await payload.update({ collection: 'races', id: race.id, data: { name: unannounced }, context: { skipRevalidation: true } })
  const stale = await showsName(unannounced)
  expect('a write that skips revalidation is not shown, so the pages really are cached', !stale.detail && !stale.list)
  await refreshRunningSite(payload, [collectionTag('races')])
  const expired = await showsName(unannounced)
  expect('expiring the tag alone brings that write through', expired.detail && expired.list)

  await payload.update({ collection: 'races', id: race.id, data: { name: renamed } })
  const after = await showsName(renamed)
  expect(`${detailPath} shows "${renamed}" after a Local API update`, after.detail)
  expect(`${listPath} shows "${renamed}" after a Local API update`, after.list)

  const viaRest = `${renamed} via REST`
  const email = `revalidation-check-${Date.now()}@erc.invalid`
  const password = `pw-${Date.now()}-check`
  const editor = await payload.create({ collection: 'staff', data: { email, password, role: 'editor' } })
  try {
    const login = await fetch(new URL('/api/staff/login', site), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const { token } = (await login.json()) as { token: string }
    const patch = await fetch(new URL(`/api/races/${race.id}`, site), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `JWT ${token}` },
      body: JSON.stringify({ name: viaRest }),
    })
    expect(`an editor's REST update is accepted (${patch.status})`, patch.ok)
    const rest = await showsName(viaRest)
    expect('an editor saving through the server, as the admin does, refreshes both pages in-process', rest.detail && rest.list)
  } finally {
    await payload.delete({ collection: 'staff', id: editor.id })
  }
} finally {
  await payload.update({ collection: 'races', id: race.id, data: { name: race.name } })
}

// Every temporary name starts with the original one, so the restore is proven by the temporary name being gone.
const leftover = await showsName(renamed)
expect(`both pages show "${race.name}" again after the restore`, !leftover.detail && !leftover.list)

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All revalidation checks passed')
process.exit(0)
