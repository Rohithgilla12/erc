import config from '@payload-config'
import {
  OPERATIONS,
  ownedBy,
  runView,
  STATUS,
  type AccessOf,
  type ApiError,
  type Dashboard,
  type Envelope,
  type InputOf,
  type OperationName,
  type OutputOf,
  type OwnerOnly,
} from '@erc/contract'
import { CLUB_TIME_ZONE, err, monthOf, ok, todayIn, totalsOf, weekOf, type Carrier, type RawInput, type Result } from '@erc/domain'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { cache } from 'react'

import { senderKeyOf } from '@/content/form-guard'

import { listRuns, recordManual, runsIn } from './activities'
import { claimAthlete, myAthlete, searchClaimable, setPhoto, setVisibility, startAthlete, updateProfile, type AthleteRefusal } from './athlete'
import { startSignIn, verifySignIn, type StartRefusal, type VerifyRefusal } from './sign-in'
import { listSessions, resolveSession, revokeOwnSession, revokeSession, SESSION_COOKIE, type MemberSession } from './session'

export { STATUS }
export { signInOpen } from './sign-in'

/**
 * Who is asking. `sender` is the keyed network hash the public forms use, for per-sender limits. An anonymous caller
 * who presented a token that no longer works is still anonymous, so an app with a stale token can start signing in
 * again; `rejectedToken` only changes what a member operation tells them.
 */
export type Caller = { kind: 'anonymous'; carrier: Carrier; sender: string; rejectedToken: boolean } | { kind: 'member'; session: MemberSession; sender: string }

type ContextFor<A> = A extends 'member' ? { session: MemberSession; sender: string } : { caller: Caller }

/** Domain refusals map to an API code here and nowhere else. `invalid` and `unauthenticated` are `run`'s to raise. */
export type OpFailure = { code: Exclude<ApiError['code'], 'invalid' | 'unauthenticated'>; message: string }

export type Handler<K extends OperationName> = (ctx: ContextFor<AccessOf<K>>, input: InputOf<K>) => Promise<Result<OutputOf<K>, OpFailure>>

/** Total over OPERATIONS: a contract entry without an implementation fails the build. */
export type Implementations = { readonly [K in OperationName]: Handler<K> }

const START_REFUSALS: Record<StartRefusal, OpFailure> = {
  per_address: { code: 'rate_limited', message: 'We have sent several codes to this address in the last hour. Use the latest one, or try again later.' },
  per_sender: { code: 'rate_limited', message: 'We have had several sign-in requests from your connection in the last hour. Please try again later.' },
  too_many_failures: { code: 'rate_limited', message: 'Too many wrong codes have been entered for this address today. Please try again tomorrow.' },
  unavailable: { code: 'unavailable', message: 'We cannot send sign-in codes just now. Please try again in a few minutes.' },
}

const RUN_REFUSALS: Record<'too_many', OpFailure> = {
  too_many: { code: 'rate_limited', message: 'You have logged a lot of runs in the last hour. Please wait a while before logging more.' },
}

const VERIFY_REFUSALS: Record<VerifyRefusal, OpFailure> = {
  wrong_code: { code: 'forbidden', message: 'That code is not right, or it has expired. Check the email, or ask for a new code.' },
  locked: { code: 'rate_limited', message: 'That code has had too many wrong tries. Ask for a new code.' },
  suspended: { code: 'forbidden', message: 'This account is suspended. Contact the club if you think that is a mistake.' },
}

const ATHLETE_REFUSALS: Record<AthleteRefusal, OpFailure> = {
  claim_pending: { code: 'conflict', message: 'Your claim is waiting for a coach to review it. You can change the profile once it is approved.' },
  has_profile: { code: 'conflict', message: 'You already have an athlete profile.' },
  not_claimable: { code: 'not_found', message: 'That profile cannot be claimed. Search again, or start your own.' },
  claim_open: { code: 'conflict', message: 'Someone has already asked to claim that profile. If it is yours, contact the club.' },
  no_profile: { code: 'not_found', message: 'You have no athlete profile yet. Claim yours or start one.' },
  profile_rejected: { code: 'conflict', message: 'This profile was not approved. Claim your profile or start a new one.' },
  not_an_image: { code: 'unsupported_media_type', message: 'That file could not be read as an image. Upload a JPEG, PNG or WebP photo.' },
  busy: { code: 'conflict', message: 'Something changed while you were saving. Check your profile and try again.' },
}

const athleteResult = <T>(result: Result<T, AthleteRefusal>, member: MemberSession['member']): Result<OwnerOnly<T>, OpFailure> =>
  result.ok ? ok(ownedBy(member, result.value)) : err(ATHLETE_REFUSALS[result.error])

const IMPLEMENTATIONS: Implementations = {
  signInStart: async ({ caller }, input) => {
    const payload = await getPayload({ config })
    const sent = await startSignIn(payload, input, caller.sender)
    return sent.ok ? sent : err(START_REFUSALS[sent.error])
  },
  signInVerify: async ({ caller }, input) => {
    const payload = await getPayload({ config })
    const issued = await verifySignIn(payload, input, caller.kind === 'member' ? caller.session.carrier : caller.carrier)
    return issued.ok ? issued : err(VERIFY_REFUSALS[issued.error])
  },
  signOut: async ({ session }) => {
    await revokeSession(await getPayload({ config }), session)
    return ok({ signedOut: true })
  },
  listSessions: async ({ session }) => {
    const items = await listSessions(await getPayload({ config }), session)
    return ok(ownedBy(session.member, { items }))
  },
  revokeSession: async ({ session }, input) => {
    const revoked = await revokeOwnSession(await getPayload({ config }), session, input.session)
    return revoked ? ok(ownedBy(session.member, { revoked: true })) : err({ code: 'not_found', message: 'That device is not in your list.' })
  },
  dashboard: async ({ session }) => {
    const payload = await getPayload({ config })
    const today = todayIn(CLUB_TIME_ZONE)
    const [week, month] = [weekOf(today), monthOf(today)]
    const [weekRuns, monthRuns, athlete] = await Promise.all([runsIn(payload, session, week), runsIn(payload, session, month), myAthlete(payload, session)])
    const dashboard: Dashboard = ownedBy(session.member, {
      member: { email: session.email },
      today,
      week: { ...week, totals: totalsOf(weekRuns) },
      month: { ...month, totals: totalsOf(monthRuns) },
      athlete,
    })
    return ok(dashboard)
  },
  logRun: async ({ session }, input) => {
    const run = await recordManual(await getPayload({ config }), session, input)
    return run.ok ? ok(ownedBy(session.member, runView(run.value))) : err(RUN_REFUSALS[run.error])
  },
  listRuns: async ({ session }, input) => {
    const page = await listRuns(await getPayload({ config }), session, input.after)
    return ok(ownedBy(session.member, { items: page.items.map(runView), next: page.next }))
  },
  myAthlete: async ({ session }) => ok(ownedBy(session.member, await myAthlete(await getPayload({ config }), session))),
  searchAthletes: async ({ session }, input) => {
    const found = await searchClaimable(await getPayload({ config }), session, input.q)
    return found.ok ? ok({ items: found.value }) : err({ code: 'rate_limited', message: 'You have searched a lot in the last hour. Please wait a while before searching again.' })
  },
  claimAthlete: async ({ session }, input) => athleteResult(await claimAthlete(await getPayload({ config }), session, input), session.member),
  startAthlete: async ({ session }, input) => athleteResult(await startAthlete(await getPayload({ config }), session, input), session.member),
  updateProfile: async ({ session }, input) => athleteResult(await updateProfile(await getPayload({ config }), session, input), session.member),
  setPhoto: async ({ session }, input) => athleteResult(await setPhoto(await getPayload({ config }), session, input.photo), session.member),
  setVisibility: async ({ session }, input) => athleteResult(await setVisibility(await getPayload({ config }), session, input), session.member),
}

/**
 * The single door for member actions. Parses raw input with the contract's parser, refuses a member operation
 * without a session, and runs the handler. Server actions pass form fields, pages pass plain objects, and the HTTP
 * adapter passes the JSON body or query string. All three get the same validation and the same errors.
 */
export async function run<K extends OperationName>(name: K, caller: Caller, raw: RawInput): Promise<Envelope<OutputOf<K>>> {
  const spec = OPERATIONS[name]
  const parsed = spec.parse(raw)
  if (!parsed.ok) return { ok: false, error: { code: 'invalid', message: 'Check the highlighted fields.', fields: parsed.error } }
  const handler = IMPLEMENTATIONS[name] as Handler<K>
  let context: ContextFor<AccessOf<K>>
  if (spec.access === 'member') {
    if (caller.kind !== 'member') {
      return { ok: false, error: { code: 'unauthenticated', message: caller.rejectedToken ? 'That token is not valid. Sign in again.' : 'Sign in to continue.' } }
    }
    context = { session: caller.session, sender: caller.sender } as ContextFor<AccessOf<K>>
  } else {
    context = { caller } as ContextFor<AccessOf<K>>
  }
  const result = await handler(context, parsed.value as InputOf<K>)
  return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error }
}

/** The caller behind the current page or server action: the session cookie, never a bearer. Cached per request. */
export const currentCaller = cache(async (): Promise<Caller> => {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()])
  const sender = senderKeyOf('sign-in', requestHeaders)
  const token = jar.get(SESSION_COOKIE)?.value
  const session = token ? await resolveSession(await getPayload({ config }), token, 'cookie') : null
  return session ? { kind: 'member', session, sender } : { kind: 'anonymous', carrier: 'cookie', sender, rejectedToken: token !== undefined }
})

/** For `/me` pages: the member, or a redirect to sign in. */
export async function requireMember(): Promise<Extract<Caller, { kind: 'member' }>> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  return caller
}

/** For `/api/v1`: the bearer token, never the cookie. A bearer that does not resolve leaves the caller anonymous. */
export async function bearerCaller(request: Request): Promise<Caller> {
  const sender = senderKeyOf('sign-in', request.headers)
  const authorization = request.headers.get('authorization')
  if (!authorization) return { kind: 'anonymous', carrier: 'bearer', sender, rejectedToken: false }
  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1]
  const session = token ? await resolveSession(await getPayload({ config }), token, 'bearer') : null
  return session ? { kind: 'member', session, sender } : { kind: 'anonymous', carrier: 'bearer', sender, rejectedToken: true }
}
