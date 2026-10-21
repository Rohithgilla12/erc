import { createHash, randomBytes } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { IssuedSession, SessionToken, SessionView } from '@erc/contract'
import { checkSession, SESSION_COOKIE_MAX_AGE_S, sessionExpiryFrom, type Carrier, type Email, type Instant, type MemberId, type MemberStatus } from '@erc/domain'
import type { Payload } from 'payload'

export type { Carrier }

/**
 * `__Host-` pins the cookie to this origin, path `/`, and HTTPS. Browsers treat `localhost` as a secure origin, so
 * the same cookie works in local http runs; a check script that manages its own cookie jar never enforces the prefix.
 */
export const SESSION_COOKIE = '__Host-erc_member'

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
export async function issueSession(payload: Payload, member: MemberId, carrier: Carrier, label: string): Promise<IssuedSession> {
  const token = `erc_${randomBytes(32).toString('base64url')}` as SessionToken
  const expiresAt = sessionExpiryFrom(new Date())
  await payload.db.drizzle.execute(
    sql`INSERT INTO member_sessions (member_id, token_hash, carrier, label, expires_at) VALUES (${member}, ${hashOf(token)}, ${carrier}, ${label}, ${expiresAt})`,
  )
  return { token, expiresAt }
}

type SessionRow = { id: string; member_id: number; email: string; status: MemberStatus; expires_at: Date | string; last_seen_at: Date | string }

/**
 * Null for an unknown, expired, or revoked token, for a suspended member, and for a token presented by the other
 * carrier: a cookie never works as a bearer, nor a bearer as a cookie. Slides the expiry at most once a day.
 */
export async function resolveSession(payload: Payload, token: string, carrier: Carrier): Promise<MemberSession | null> {
  if (!TOKEN.test(token)) return null
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT s.id, s.member_id, s.expires_at, s.last_seen_at, m.email, m.status
    FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ${hashOf(token)} AND s.carrier = ${carrier}`)
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

type DeviceRow = { id: string; label: string; created_at: Date | string; last_seen_at: Date | string }

/** Every live session of the caller's member, newest first. Nothing identifies the device beyond its label and dates. */
export async function listSessions(payload: Payload, session: MemberSession): Promise<readonly SessionView[]> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT id, label, created_at, last_seen_at FROM member_sessions
    WHERE member_id = ${session.member} AND expires_at > now()
    ORDER BY created_at DESC, id`)
  return (rows as DeviceRow[]).map((row) => ({
    id: row.id,
    label: row.label,
    current: row.id === session.id,
    createdAt: instantOf(row.created_at),
    lastSeenAt: instantOf(row.last_seen_at),
  }))
}

/** Ends one of the caller's own sessions. False when the id is not theirs, which the caller cannot tell from "not found". */
export async function revokeOwnSession(payload: Payload, session: MemberSession, id: string): Promise<boolean> {
  const { rows } = await payload.db.drizzle.execute(sql`DELETE FROM member_sessions WHERE id = ${id} AND member_id = ${session.member} RETURNING id`)
  return rows.length > 0
}

const COOKIE = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' }

/** The cookie outlives any slide of the row, so the row's `expires_at` alone decides whether the member is signed in. */
export const sessionCookie = () => ({ ...COOKIE, maxAge: SESSION_COOKIE_MAX_AGE_S })
export const clearedSessionCookie = () => ({ ...COOKIE, expires: new Date(0) })
