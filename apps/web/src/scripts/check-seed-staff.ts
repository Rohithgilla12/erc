/**
 * Proves the seed scripts' staff account cannot be signed into with a password anyone could know or guess:
 * `pnpm payload run src/scripts/check-seed-staff.ts`. Uses its own account and deletes it.
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { seedStaffAccount } from './staff-account'

const payload = await getPayload({ config })
const email = `seed-check-${Date.now()}@erc.invalid`
const failures: string[] = []
let passes = 0

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (ok) passes += 1
  else failures.push(label)
}

const signsIn = (password: string) =>
  payload.login({ collection: 'staff', data: { email, password } }).then(
    () => true,
    () => false,
  )

try {
  const created = await seedStaffAccount(payload, email, 'editor')
  expect('a new seed account is an editor tagged as staff', [created.role, created.collection], ['editor', 'staff'])
  expect('its password is not the old timestamp pattern', await signsIn(`seed-${new Date(created.createdAt).getTime()}`), false)

  const guessable = `seed-${Date.now()}`
  await payload.update({ collection: 'staff', id: created.id, data: { password: guessable } })
  expect('the guessable password works before a seed runs', await signsIn(guessable), true)
  const again = await seedStaffAccount(payload, email, 'editor')
  expect('a seed run reuses the account', again.id, created.id)
  expect('and rotates the guessable password away', await signsIn(guessable), false)
} finally {
  await payload.delete({ collection: 'staff', where: { email: { equals: email } } })
}

console.log(`check-seed-staff: ${passes} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)
