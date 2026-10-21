import {
  CLUB_TIME_ZONE,
  ok,
  parseManualEntry,
  parseSignInStart,
  parseSignInVerify,
  todayIn,
  type Activity,
  type Brand,
  type Email,
  type FieldErrors,
  type Instant,
  type MemberId,
  type Period,
  type PublicSource,
  type RawInput,
  type Result,
  type Totals,
} from '@erc/domain'

export const API_BASE = '/api/v1'

export type ApiErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'rate_limited' | 'unavailable'

/** The only error shape. `fields` is present only for `invalid`, keyed like the input. */
export type ApiError = { code: ApiErrorCode; message: string; fields?: FieldErrors }
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
}

/** Opaque to clients; the server encodes the sort key. */
export type Cursor = Brand<string, 'Cursor'>
export type Page<T> = { items: readonly T[]; next: Cursor | null }

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

/** `after` is a cursor from the previous page; anything else starts from the newest run. */
const parseListRuns = (raw: RawInput): Result<{ after: Cursor | null }, FieldErrors> => {
  const after = typeof raw.after === 'string' && raw.after !== '' ? (raw.after as Cursor) : null
  return ok({ after })
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
    fields: phantom<{ email: string; code: string }>(),
    output: phantom<IssuedSession>(),
  }),
  signOut: op({ method: 'POST', path: '/auth/sign-out', access: 'member', parse: noInput, fields: phantom<Record<string, never>>(), output: phantom<{ signedOut: true }>() }),
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
