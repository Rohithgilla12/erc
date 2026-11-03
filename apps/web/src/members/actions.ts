'use server'

import { randomUUID } from 'node:crypto'

import type { RunView } from '@erc/contract'
import type { FieldErrors } from '@erc/domain'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { fieldsOf, HONEYPOT_FIELD, TOKEN_FIELD } from '@/content/form-fields'
import { checkFormToken, issueFormToken } from '@/content/form-guard'

import { currentCaller, run } from './run'
import { clearedSessionCookie, SESSION_COOKIE, sessionCookie } from './session'

/**
 * The sign-in form's two steps. `token` is the signed time the form was first shown and travels with every state, as
 * on the Phase 1 forms. `notice` carries a refusal, `errors` a field problem; both travel with the step that shows
 * the form again, so a retry keeps what was typed.
 */
export type SignInFormState = { step: 'email' | 'code'; token: string; email: string; errors?: FieldErrors; notice?: string }

const TIMING_NOTICES = {
  too_fast: 'That was quicker than we expect from a person. Please send it again.',
  expired: 'This form was open for a long time, so we refreshed it. Please send it again.',
}

export async function signIn(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const fields = fieldsOf(form)
  const email = fields.email ?? ''
  const token = fields[TOKEN_FIELD] ?? ''
  const caller = await currentCaller()
  if (fields.step === 'code') {
    const verified = await run('signInVerify', caller, fields)
    if (!verified.ok) {
      const { error } = verified
      return error.code === 'invalid' ? { step: 'code', token, email, ...(error.fields ? { errors: error.fields } : {}) } : { step: 'code', token, email, notice: error.message }
    }
    // Signing in again from a browser that still holds a session replaces it, so the old row does not live on unseen.
    if (caller.kind === 'member') await run('signOut', caller, {})
    const jar = await cookies()
    jar.set(SESSION_COOKIE, verified.data.token, sessionCookie())
    redirect('/me')
  }
  // Told it worked, so a bot learns nothing and spends no email.
  if ((fields[HONEYPOT_FIELD] ?? '') !== '') return { step: 'code', token, email }
  const timing = checkFormToken('sign-in', token)
  if (timing === 'too_fast') return { step: 'email', token, email, notice: TIMING_NOTICES.too_fast }
  if (timing !== 'ok') return { step: 'email', token: issueFormToken('sign-in'), email, notice: TIMING_NOTICES.expired }
  const started = await run('signInStart', caller, fields)
  if (started.ok) return { step: 'code', token, email: email.trim().toLowerCase() }
  const { error } = started
  return error.code === 'invalid' ? { step: 'email', token, email, ...(error.fields ? { errors: error.fields } : {}) } : { step: 'email', token, email, notice: error.message }
}

export async function signOut(): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind === 'member') await run('signOut', caller, {})
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', clearedSessionCookie())
  redirect('/')
}

/** The sign-out button beside another device on /me. The current device keeps its own sign-out form. */
export async function signOutDevice(form: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('revokeSession', caller, fieldsOf(form))
  revalidatePath('/me')
  redirect('/me#devices')
}

export type RunValues = { date: string; distanceKm: string; duration: string; note?: string }

/** `ref` is minted when the form is shown, so sending the same form twice logs one run. A saved run gets a fresh one. */
export type RunFormState = { ref: string; values: RunValues; errors?: FieldErrors; notice?: string; saved?: RunView }

export async function logRun(previous: RunFormState, form: FormData): Promise<RunFormState> {
  const fields = fieldsOf(form)
  const values: RunValues = {
    date: fields.date ?? '',
    distanceKm: fields.distanceKm ?? '',
    duration: fields.duration ?? '',
    ...(fields.note !== undefined ? { note: fields.note } : {}),
  }
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const logged = await run('logRun', caller, { ...fields, ref: fields.ref || previous.ref })
  if (!logged.ok) {
    const { error } = logged
    return error.code === 'invalid' ? { ref: previous.ref, values, ...(error.fields ? { errors: error.fields } : {}) } : { ref: previous.ref, values, notice: error.message }
  }
  revalidatePath('/me')
  return { ref: randomUUID(), values: { date: values.date, distanceKm: '', duration: '', note: '' }, saved: logged.data }
}

export async function requestCoachAction(formData: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const fields = fieldsOf(formData)
  await run('requestCoach', caller, { coachId: Number(fields.coachId) })
  revalidatePath('/me')
  revalidatePath('/me/coaching')
  redirect('/me/coaching')
}

export async function endCoachingAction(_formData: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('endCoaching', caller, {})
  revalidatePath('/me')
  revalidatePath('/me/coaching')
  redirect('/me/coaching')
}

export async function decideCoachingAction(formData: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const linkId = String(formData.get('linkId') ?? '')
  const decision = String(formData.get('decision') ?? '') as 'accept' | 'reject'
  await run('decideCoachingRequest', caller, { linkId, decision })
  revalidatePath('/me/coach')
  redirect('/me/coach')
}

export async function saveWeekReviewAction(formData: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const athleteSlug = String(formData.get('athleteSlug') ?? '')
  const weekStart = String(formData.get('weekStart') ?? '')
  const watch = String(formData.get('watch') ?? '')
  const recommendations = String(formData.get('recommendations') ?? '')
  const note = String(formData.get('note') ?? '')
  const res = await run('saveWeekReview', caller, { athleteSlug, weekStart, watch, recommendations, note })
  revalidatePath(`/me/coach/${athleteSlug}`)
  revalidatePath('/me')
  const weekParam = weekStart ? `&weekStart=${encodeURIComponent(weekStart)}` : ''
  if (!res.ok) {
    redirect(`/me/coach/${athleteSlug}?error=${encodeURIComponent(res.error.message)}${weekParam}`)
  }
  redirect(`/me/coach/${athleteSlug}?saved=true${weekParam}`)
}

export type CheckInValues = { feeling: string; niggles?: string; note?: string }

export type CheckInFormState = {
  values: CheckInValues
  errors?: FieldErrors
  notice?: string
  saved?: boolean
}

export async function submitCheckInAction(previous: CheckInFormState, formData: FormData): Promise<CheckInFormState> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const fields = fieldsOf(formData)
  const values: CheckInValues = {
    feeling: fields.feeling ?? '',
    niggles: fields.niggles ?? '',
    note: fields.note ?? '',
  }
  const done = await run('submitCheckIn', caller, fields)
  if (!done.ok) {
    const { error } = done
    return error.code === 'invalid'
      ? { values, ...(error.fields ? { errors: error.fields } : {}) }
      : { values, notice: error.message }
  }
  revalidatePath('/me')
  redirect('/me')
}

/** Every athlete form on /me/athlete: what was typed, so a refusal shows it again, and the outcome. */
export type ProfileFormState = { values: Readonly<Record<string, string>>; errors?: FieldErrors; notice?: string; saved?: string }

type ProfileOperation = 'claimAthlete' | 'startAthlete' | 'updateProfile' | 'setPhoto' | 'setVisibility'

const SAVED: Record<ProfileOperation, string> = {
  claimAthlete: 'Claim sent. A coach will review it.',
  startAthlete: 'Profile sent for review.',
  updateProfile: 'Saved.',
  setPhoto: 'Saved.',
  setVisibility: 'Saved. The public pages now show exactly this.',
}

async function profileAction(name: ProfileOperation, form: FormData): Promise<ProfileFormState> {
  // The typed text comes back with a refusal; an uploaded file goes to the operation only.
  const values = fieldsOf(form)
  const files = Object.fromEntries([...form].filter(([key, value]) => typeof value !== 'string' && !(key in values)))
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const done = await run(name, caller, { ...files, ...values })
  if (!done.ok) {
    const { error } = done
    return error.code === 'invalid' ? { values, ...(error.fields ? { errors: error.fields } : {}) } : { values, notice: error.message }
  }
  revalidatePath('/me', 'layout')
  return { values, saved: SAVED[name] }
}

export async function claimProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  return profileAction('claimAthlete', form)
}

export async function startProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  return profileAction('startAthlete', form)
}

export async function saveProfile(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  return profileAction('updateProfile', form)
}

export async function savePhoto(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  return profileAction('setPhoto', form)
}

export async function saveVisibility(_previous: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  return profileAction('setVisibility', form)
}

export { disconnectStravaAction, joinStravaWaitlistAction, syncStravaAction } from '@/app/(frontend)/me/actions'

