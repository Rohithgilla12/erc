import {
  CLUB_TIME_ZONE,
  err,
  ok,
  parseLocalDate,
  parseManualEntry,
  parseRevokeSession,
  parseSignInStart,
  parseSignInVerify,
  parseSourceRef,
  todayIn,
  type Activity,
  type Brand,
  type Email,
  type FieldErrors,
  type Instant,
  type LocalDate,
  type MemberId,
  type Period,
  type PublicSource,
  type RawInput,
  type Result,
  type SourceRef,
  type Totals,
} from '@erc/domain'

export const API_BASE = '/api/v1'

export type ApiErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'unsupported_media_type' | 'conflict' | 'rate_limited' | 'unavailable'

/** The only error shape. `fields` is present only for `invalid`, keyed like the input. */
export type ApiError = { code: ApiErrorCode; message: string; fields?: FieldErrors }
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  unsupported_media_type: 415,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
}

/** Opaque to clients; the server encodes the sort key. */
export type Cursor = Brand<string, 'Cursor'>
export type Page<T> = { items: readonly T[]; next: Cursor | null }

/** The sort key behind a runs cursor: the position of the last run shown, newest first. */
export type RunCursor = { on: LocalDate; loggedAt: Instant; ref: SourceRef }

// Both Node and browsers have these; declared here because the package compiles with no DOM or Node lib.
declare const btoa: (text: string) => string
declare const atob: (text: string) => string

// The three parts are a date, an ISO instant and a ref, all ASCII, so base64 of the text itself is enough.
const toBase64Url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromBase64Url = (text: string): string | null => {
  // A length one past a multiple of four is not base64 at all, and atob throws on it.
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(text) || text.length % 4 === 1) return null
  const decoded = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return /^[\x21-\x7e]+$/.test(decoded) ? decoded : null
}

export const encodeRunCursor = (run: Pick<Activity, 'on' | 'loggedAt' | 'ref'>): Cursor => toBase64Url(`${run.on}|${run.loggedAt}|${run.ref}`) as Cursor

/**
 * Every part must round-trip: a real calendar date, an instant exactly as the server writes it, and a source ref. A
 * cursor is then a parsed value by the time it is a query parameter, and the database only ever sees well-formed ones.
 */
export const parseRunCursor = (raw: string): Result<RunCursor, 'not_a_cursor'> => {
  const parts = fromBase64Url(raw)?.split('|')
  if (!parts || parts.length !== 3) return err('not_a_cursor')
  const [onText = '', loggedAt = '', refText = ''] = parts
  const on = parseLocalDate(onText)
  const ref = parseSourceRef(refText)
  const instant = Date.parse(loggedAt)
  if (!on.ok || !ref.ok || Number.isNaN(instant) || new Date(instant).toISOString() !== loggedAt) return err('not_a_cursor')
  return ok({ on: on.value, loggedAt: loggedAt as Instant, ref: ref.value })
}

export type SessionToken = Brand<string, 'SessionToken'>
/** Returned by every sign-in. The web sets it as an HttpOnly cookie; an app keeps it in secure storage and sends it as a bearer token. */
export type IssuedSession = { token: SessionToken; expiresAt: Instant }

declare const ownerOnly: unique symbol
/**
 * Data only the member it describes may receive. A public operation whose output contains one does not compile, see
 * `PublicSafe`.
 */
export type OwnerOnlyMark = { readonly [ownerOnly]: MemberId }
export type OwnerOnly<T> = T & OwnerOnlyMark

/** The only way to build owner-only data: server code names the member whose session it holds. */
export const ownedBy = <T>(_member: MemberId, value: T): OwnerOnly<T> => value as OwnerOnly<T>

export type Method = 'GET' | 'POST'
export type Access = 'anyone' | 'member'

type HasOwnerOnly<T> = T extends OwnerOnlyMark
  ? true
  : T extends readonly (infer U)[]
    ? HasOwnerOnly<U>
    : T extends object
      ? true extends { [K in keyof T]-?: HasOwnerOnly<T[K]> }[keyof T]
        ? true
        : false
      : false

/** An operation anyone may call cannot return owner-only data: its output type collapses to `never`. */
export type PublicSafe<A extends Access, O> = A extends 'anyone' ? (HasOwnerOnly<O> extends true ? never : O) : O

export type Operation<A extends Access, F extends RawInput, I, O> = {
  method: Method
  /** Relative to API_BASE. GET input travels as the query string, POST input as a JSON body. */
  path: `/${string}`
  access: A
  /** A domain parser. The web form, the HTTP body and an app's own form validation all run this one function. */
  parse: (raw: RawInput) => Result<I, FieldErrors>
  /** Phantom; the raw fields a client sends. */
  fields: (f: F) => F
  /** Phantom; the output type. */
  output: (o: O) => O
}

const op = <A extends Access, F extends RawInput, I, O>(spec: Operation<A, F, I, PublicSafe<A, O>>) => spec
const phantom =
  <T>() =>
  (value: T) =>
    value
const noInput = (_raw: RawInput): Result<Record<string, never>, FieldErrors> => ok({})

export type RunView = { source: PublicSource; ref: string; on: string; distance: number; moving: number; loggedAt: Instant }

const runView = (run: Activity<PublicSource>): RunView => ({
  source: run.source,
  ref: run.ref,
  on: run.on,
  distance: run.distance,
  moving: run.moving,
  loggedAt: run.loggedAt,
})
export { runView }

export type PeriodTotals = Period & { totals: Totals }

export type Dashboard = OwnerOnly<{ member: { email: Email }; today: string; week: PeriodTotals; month: PeriodTotals }>

/** One signed-in device. `current` marks the session making the request, which the page shows without a sign-out button. */
export type SessionView = { id: string; label: string; current: boolean; createdAt: Instant; lastSeenAt: Instant }

/** `after` is a cursor from the previous page; absent or empty starts from the newest run, and anything else is refused. */
const parseListRuns = (raw: RawInput): Result<{ after: RunCursor | null }, FieldErrors> => {
  if (typeof raw.after !== 'string' || raw.after === '') return ok({ after: null })
  const cursor = parseRunCursor(raw.after)
  return cursor.ok ? ok({ after: cursor.value }) : err({ after: 'That page link is not valid. Start again from the newest runs.' })
}

const logRunInput = (raw: RawInput) => parseManualEntry(raw, todayIn(CLUB_TIME_ZONE))

type ManualRunFields = { ref?: string; date?: string; distanceKm: string; duration: string }

/**
 * The one list of everything a member can do. The server implements every entry (a total map), the web dashboard
 * calls entries in-process through `run`, the HTTP adapter serves every entry under `/api/v1`, and `createClient` is
 * derived from it. A dashboard feature therefore cannot exist without its API.
 */
export const OPERATIONS = {
  signInStart: op({
    method: 'POST',
    path: '/auth/code',
    access: 'anyone',
    parse: parseSignInStart,
    fields: phantom<{ email: string; over18: string | boolean }>(),
    output: phantom<{ sent: true }>(),
  }),
  signInVerify: op({
    method: 'POST',
    path: '/auth/verify',
    access: 'anyone',
    parse: parseSignInVerify,
    fields: phantom<{ email: string; code: string; device?: string }>(),
    output: phantom<IssuedSession>(),
  }),
  signOut: op({ method: 'POST', path: '/auth/sign-out', access: 'member', parse: noInput, fields: phantom<Record<string, never>>(), output: phantom<{ signedOut: true }>() }),
  listSessions: op({ method: 'GET', path: '/me/sessions', access: 'member', parse: noInput, fields: phantom<Record<string, never>>(), output: phantom<OwnerOnly<{ items: readonly SessionView[] }>>() }),
  revokeSession: op({ method: 'POST', path: '/me/sessions/revoke', access: 'member', parse: parseRevokeSession, fields: phantom<{ session: string }>(), output: phantom<OwnerOnly<{ revoked: true }>>() }),
  dashboard: op({ method: 'GET', path: '/me/dashboard', access: 'member', parse: noInput, fields: phantom<Record<string, never>>(), output: phantom<Dashboard>() }),
  logRun: op({ method: 'POST', path: '/me/runs', access: 'member', parse: logRunInput, fields: phantom<ManualRunFields>(), output: phantom<OwnerOnly<RunView>>() }),
  listRuns: op({ method: 'GET', path: '/me/runs', access: 'member', parse: parseListRuns, fields: phantom<{ after?: string }>(), output: phantom<OwnerOnly<Page<RunView>>>() }),
} as const

export type Operations = typeof OPERATIONS
export type OperationName = keyof Operations
export type AccessOf<K extends OperationName> = Operations[K]['access']
export type FieldsOf<K extends OperationName> = Parameters<Operations[K]['fields']>[0]
export type InputOf<K extends OperationName> = Operations[K]['parse'] extends (raw: RawInput) => Result<infer I, FieldErrors> ? I : never
export type OutputOf<K extends OperationName> = Parameters<Operations[K]['output']>[0]

export const OPERATION_NAMES = Object.keys(OPERATIONS) as readonly OperationName[]

/** The operation an HTTP method and path name, or null. The adapter and the client agree through this one function. */
export const operationFor = (method: string, path: string): OperationName | null =>
  OPERATION_NAMES.find((name) => OPERATIONS[name].method === method && OPERATIONS[name].path === path) ?? null

/** Minimal fetch shape, so the package needs no DOM lib. */
export type FetchLike = (url: string, init: { method: Method; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>

export type Client = { readonly [K in OperationName]: (fields: FieldsOf<K>) => Promise<Envelope<OutputOf<K>>> }

const queryOf = (fields: RawInput) => {
  const pairs = Object.entries(fields).filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1] !== '')
  return pairs.length === 0 ? '' : `?${pairs.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`
}

const isEnvelope = (body: unknown): body is Envelope<unknown> => typeof body === 'object' && body !== null && 'ok' in body

/**
 * A client derived from OPERATIONS. Responses are typed, not re-parsed: the app and server ship from one repo against
 * one versioned path, and only the envelope is checked. A reply that is not an envelope becomes `unavailable`.
 */
export const createClient = (options: { baseUrl: string; token: () => Promise<SessionToken | null>; fetch: FetchLike }): Client => {
  const call = async <K extends OperationName>(name: K, fields: FieldsOf<K>): Promise<Envelope<OutputOf<K>>> => {
    const spec = OPERATIONS[name]
    const token = await options.token()
    const headers: Record<string, string> = { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }
    const url = `${options.baseUrl}${API_BASE}${spec.path}${spec.method === 'GET' ? queryOf(fields) : ''}`
    const init = spec.method === 'GET' ? { method: spec.method, headers } : { method: spec.method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(fields) }
    const response = await options.fetch(url, init)
    const body: unknown = await response.json().catch(() => null)
    if (isEnvelope(body)) return body as Envelope<OutputOf<K>>
    return { ok: false, error: { code: 'unavailable', message: `The server answered ${response.status} without a result.` } }
  }
  return Object.fromEntries(OPERATION_NAMES.map((name) => [name, (fields: FieldsOf<typeof name>) => call(name, fields)])) as Client
}
