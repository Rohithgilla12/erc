import { randomInt } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { IssuedSession } from '@erc/contract'
import {
  checkSignInCode,
  codeExpiryFrom,
  codeFromRandom,
  deviceLabelOf,
  EMAIL_SHARES,
  err,
  ok,
  planCodeRequest,
  SIGN_IN_CODE_MAX_TRIES,
  SIGN_IN_CODE_TTL_MS,
  type Carrier,
  type CodeRequestCounts,
  type MemberId,
  type Result,
  type SignInCode,
  type SignInStart,
  type SignInVerify,
  type StoredSignInCode,
} from '@erc/domain'
import { after } from 'next/server'
import type { Payload } from 'payload'

import { CLUB } from '@/app/(frontend)/site-nav'
import { emailConfigured } from '@/cms/email'
import { withCapLock, type Transaction } from '@/content/email-cap'
import { mac, sameMac } from '@/content/form-guard'

import { instantOf, issueSession } from './session'

/** Sign-in is offered exactly when a code can be emailed, the same rule as the newsletter form. */
export const signInOpen = (): boolean => emailConfigured()

export type StartRefusal = 'per_address' | 'per_sender' | 'too_many_failures' | 'unavailable'
export type VerifyRefusal = 'wrong_code' | 'locked' | 'suspended'

// Keyed with the server's secret rather than a bare hash: a six-digit code is small enough to brute-force from a leaked table.
const codeHash = (email: string, code: SignInCode) => mac('sign-in-code', `${email}:${code}`)

const HOUR = sql`now() - interval '1 hour'`
const DAY = sql`now() - interval '1 day'`

const count = async (transaction: Transaction, where: ReturnType<typeof sql>) => {
  const { rows } = await transaction.execute(sql`SELECT count(*)::int AS n FROM sign_in_codes WHERE ${where}`)
  return (rows[0] as { n: number }).n
}

/** Wrong tries are kept on each code's row, so a day's failures for an address are the sum over its codes. Rows live a day. */
const requestCounts = async (db: Transaction, email: string, senderKey: string): Promise<CodeRequestCounts> => {
  const { rows } = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM sign_in_codes WHERE email = ${email} AND sent_at > ${HOUR}) AS to_address,
      (SELECT count(*)::int FROM sign_in_codes WHERE sender_key = ${senderKey} AND sent_at > ${HOUR}) AS by_sender,
      (SELECT coalesce(sum(tries), 0)::int FROM sign_in_codes WHERE email = ${email} AND sent_at > ${DAY}) AS failures`)
  const row = rows[0] as { to_address: number; by_sender: number; failures: number }
  return { toAddressInHour: row.to_address, bySenderInHour: row.by_sender, failuresForAddressInDay: row.failures }
}

type CodeRow = { id: number; code_hash: string; sent_at: Date | string; expires_at: Date | string; tries: number; closed_at: Date | string | null }

const latestCode = async (db: Transaction, email: string) => {
  const { rows } = await db.execute(sql`SELECT id, code_hash, sent_at, expires_at, tries, closed_at FROM sign_in_codes WHERE email = ${email} ORDER BY sent_at DESC, id DESC LIMIT 1`)
  return (rows[0] as CodeRow | undefined) ?? null
}

const storedOf = (row: CodeRow): StoredSignInCode => ({
  sentAt: instantOf(row.sent_at),
  expiresAt: instantOf(row.expires_at),
  tries: row.tries,
  closedAt: row.closed_at === null ? null : instantOf(row.closed_at),
})

async function sendCode(payload: Payload, to: string, code: SignInCode) {
  try {
    await payload.sendEmail({
      to,
      subject: `${code} is your ${CLUB.name} sign-in code`,
      text: [
        `Your ${CLUB.name} sign-in code is:`,
        '',
        code,
        '',
        `It works for ${SIGN_IN_CODE_TTL_MS / 60_000} minutes, and once. If you did not ask to sign in, ignore this email; nobody can sign in without the code.`,
      ].join('\n'),
    })
  } catch (error) {
    payload.logger.error({ err: error }, 'Could not send a sign-in code')
  }
}

/**
 * Stores a hashed code and emails it after the response. Every address is treated alike, whether or not it has an
 * account, so nothing here reveals who is a member. Under the `sign_in_code` lock so the hour's share holds under a
 * burst; a request inside a minute of a live code sends nothing and the earlier code stands.
 */
export async function startSignIn(payload: Payload, input: SignInStart, senderKey: string): Promise<Result<{ sent: true }, StartRefusal>> {
  const now = new Date()
  const outcome = await withCapLock(payload, 'sign_in_code', async (_req, db): Promise<Result<SignInCode | null, StartRefusal>> => {
    const latest = await latestCode(db, input.email)
    const step = planCodeRequest(latest && storedOf(latest), await requestCounts(db, input.email, senderKey), now)
    if (step === 'none') return ok(null)
    if (step !== 'send') return err(step)
    if ((await count(db, sql`sent_at > ${HOUR}`)) >= EMAIL_SHARES.sign_in_code) {
      payload.logger.warn({ cap: EMAIL_SHARES.sign_in_code }, 'Refused a sign-in code: the hourly share is reached')
      return err('unavailable')
    }
    const code = codeFromRandom(randomInt(1_000_000))
    // Only the newest code for an address can be used; closing the earlier ones keeps the five-try lock from resetting.
    await db.execute(sql`UPDATE sign_in_codes SET closed_at = now() WHERE email = ${input.email} AND closed_at IS NULL`)
    await db.execute(sql`
      INSERT INTO sign_in_codes (email, code_hash, sender_key, sent_at, expires_at)
      VALUES (${input.email}, ${codeHash(input.email, code)}, ${senderKey}, ${now.toISOString()}, ${codeExpiryFrom(now)})`)
    return ok(code)
  })
  if (!outcome.ok) return outcome
  if (outcome.value !== null) {
    const code = outcome.value
    after(() => sendCode(payload, input.email, code))
  }
  return ok({ sent: true })
}

type MemberRow = { id: number; status: 'active' | 'suspended' }

/**
 * Checks the newest code for the address, closes it on success (single use, decided by one conditional UPDATE so two
 * racing submissions cannot both win), then finds or creates the member and issues a session.
 */
export async function verifySignIn(payload: Payload, input: SignInVerify, carrier: Carrier): Promise<Result<IssuedSession, VerifyRefusal>> {
  const db = payload.db.drizzle
  const now = new Date()
  const row = await latestCode(db, input.email)
  const matches = row !== null && sameMac(row.code_hash, codeHash(input.email, input.code))
  const check = checkSignInCode(row && storedOf(row), matches, now)
  if (row && !matches && (check.kind === 'wrong' || check.kind === 'locked')) {
    await db.execute(sql`UPDATE sign_in_codes SET tries = tries + 1 WHERE id = ${row.id}`)
  }
  if (check.kind === 'locked') return err('locked')
  if (check.kind !== 'accepted' || !row) return err('wrong_code')

  const closed = await db.execute(sql`
    UPDATE sign_in_codes SET closed_at = now()
    WHERE id = ${row.id} AND closed_at IS NULL AND tries < ${SIGN_IN_CODE_MAX_TRIES} AND expires_at > now()
    RETURNING id`)
  if (closed.rows.length === 0) return err('wrong_code')

  const { docs } = await payload.find({ collection: 'members', where: { email: { equals: input.email } }, limit: 1, depth: 0, pagination: false })
  const found = (docs[0] as MemberRow | undefined) ?? null
  if (found?.status === 'suspended') return err('suspended')
  const context = { skipRevalidation: true }
  const member = found
    ? await payload.update({ collection: 'members', id: found.id, data: { lastSignInAt: now.toISOString() }, context, depth: 0 })
    : await payload.create({
        collection: 'members',
        // The declaration was ticked when this code was requested, so that is when it was made.
        data: { email: input.email, status: 'active', ageDeclaredAt: instantOf(row.sent_at), lastSignInAt: now.toISOString() },
        context,
        depth: 0,
      })
  // A browser is always "Web browser"; only an app, which sends the bearer, gets to name itself.
  const label = deviceLabelOf(carrier === 'bearer' ? input.device : null, carrier)
  return ok(await issueSession(payload, member.id as MemberId, carrier, label))
}
