import { createHash, randomBytes } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { IssuedSession, SessionToken } from '@erc/contract'
import { checkSession, sessionExpiryFrom, type Email, type Instant, type MemberId, type MemberStatus } from '@erc/domain'
import type { Payload } from 'payload'

/**
 * `__Host-` pins the cookie to this origin, path `/`, and HTTPS. Browsers treat `localhost` as a secure origin, so
 * the same cookie works in local http runs; a check script that manages its own cookie jar never enforces the prefix.
 */
export const SESSION_COOKIE = '__Host-erc_member'

/** How the token reached us. The API takes only bearers, pages only the cookie, so a stolen cookie cannot drive the API. */
export type Carrier = 'cookie' | 'bearer'

declare const sessionBrand: unique symbol
export type SessionId = string & { readonly [sessionBrand]: 'SessionId' }

/**
 * Proof that the current request is this member. Only `resolveSession` builds one, so a function that takes a
 * MemberSession can trust `member` and needs no further check.
 */
export type MemberSession = {
  readonly id: SessionId
  readonly member: MemberId
  readonly email: Email
  readonly carrier: Carrier
  readonly [sessionBrand]: true
}

const TOKEN = /^erc_[A-Za-z0-9_-]{43}$/
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

export const instantOf = (value: unknown): Instant => new Date(value as string | Date).toISOString() as Instant

/** `erc_` plus 32 random bytes in base64url. Only its SHA-256 is stored, so a database leak signs nobody in. */
export async function issueSession(payload: Payload, member: MemberId, carrier: Carrier): Promise<IssuedSession> {
  const token = `erc_${randomBytes(32).toString('base64url')}` as SessionToken
  const expiresAt = sessionExpiryFrom(new Date())
  await payload.db.drizzle.execute(
    sql`INSERT INTO member_sessions (member_id, token_hash, carrier, expires_at) VALUES (${member}, ${hashOf(token)}, ${carrier}, ${expiresAt})`,
  )
  return { token, expiresAt }
}

type SessionRow = { id: string; member_id: number; email: string; status: MemberStatus; expires_at: Date | string; last_seen_at: Date | string }

/** Null for an unknown, expired, or revoked token, and for a suspended member. Slides the expiry at most once a day. */
export async function resolveSession(payload: Payload, token: string, carrier: Carrier): Promise<MemberSession | null> {
  if (!TOKEN.test(token)) return null
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT s.id, s.member_id, s.expires_at, s.last_seen_at, m.email, m.status
    FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ${hashOf(token)}`)
  const row = rows[0] as SessionRow | undefined
  if (!row) return null
  const now = new Date()
  const check = checkSession({ expiresAt: instantOf(row.expires_at), lastSeenAt: instantOf(row.last_seen_at), memberStatus: row.status }, now)
  if (check === 'expired') {
    await payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE id = ${row.id}`)
    return null
  }
  if (check === 'suspended') return null
  if (check === 'live_touch') {
    await payload.db.drizzle.execute(sql`UPDATE member_sessions SET last_seen_at = now(), expires_at = ${sessionExpiryFrom(now)} WHERE id = ${row.id}`)
  }
  return { id: row.id as SessionId, member: row.member_id as MemberId, email: row.email as Email, carrier } as MemberSession
}

export async function revokeSession(payload: Payload, session: MemberSession): Promise<void> {
  await payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE id = ${session.id}`)
}

export const sessionCookie = (expiresAt: Instant | null) => ({
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  expires: expiresAt ? new Date(expiresAt) : new Date(0),
})
