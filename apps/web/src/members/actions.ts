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

export type RunValues = { date: string; distanceKm: string; duration: string }

/** `ref` is minted when the form is shown, so sending the same form twice logs one run. A saved run gets a fresh one. */
export type RunFormState = { ref: string; values: RunValues; errors?: FieldErrors; notice?: string; saved?: RunView }

export async function logRun(previous: RunFormState, form: FormData): Promise<RunFormState> {
  const fields = fieldsOf(form)
  const values: RunValues = { date: fields.date ?? '', distanceKm: fields.distanceKm ?? '', duration: fields.duration ?? '' }
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const logged = await run('logRun', caller, { ...fields, ref: fields.ref || previous.ref })
  if (!logged.ok) {
    const { error } = logged
    return error.code === 'invalid' ? { ref: previous.ref, values, ...(error.fields ? { errors: error.fields } : {}) } : { ref: previous.ref, values, notice: error.message }
  }
  revalidatePath('/me')
  return { ref: randomUUID(), values: { date: values.date, distanceKm: '', duration: '' }, saved: logged.data }
}
