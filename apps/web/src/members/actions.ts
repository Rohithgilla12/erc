'use server'

import { randomUUID } from 'node:crypto'

import type { RunView } from '@erc/contract'
import type { FieldErrors } from '@erc/domain'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { fieldsOf, HONEYPOT_FIELD } from '@/content/form-fields'

import { currentCaller, run } from './run'
import { SESSION_COOKIE, sessionCookie } from './session'

/**
 * The sign-in form's two steps. `notice` carries a refusal, `errors` a field problem; both travel with the step that
 * shows the form again, so a retry keeps what was typed.
 */
export type SignInFormState = { step: 'email' | 'code'; email: string; errors?: FieldErrors; notice?: string }

export async function signIn(_previous: SignInFormState, form: FormData): Promise<SignInFormState> {
  const fields = fieldsOf(form)
  const email = fields.email ?? ''
  const caller = await currentCaller()
  if (fields.step === 'code') {
    const verified = await run('signInVerify', caller, fields)
    if (!verified.ok) {
      const { error } = verified
      return error.code === 'invalid' ? { step: 'code', email, ...(error.fields ? { errors: error.fields } : {}) } : { step: 'code', email, notice: error.message }
    }
    const jar = await cookies()
    jar.set(SESSION_COOKIE, verified.data.token, sessionCookie(verified.data.expiresAt))
    redirect('/me')
  }
  // Told it worked, so a bot learns nothing and spends no email.
  if ((fields[HONEYPOT_FIELD] ?? '') !== '') return { step: 'code', email }
  const started = await run('signInStart', caller, fields)
  if (started.ok) return { step: 'code', email: email.trim().toLowerCase() }
  const { error } = started
  return error.code === 'invalid' ? { step: 'email', email, ...(error.fields ? { errors: error.fields } : {}) } : { step: 'email', email, notice: error.message }
}

export async function signOut(): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind === 'member') await run('signOut', caller, {})
  const jar = await cookies()
  jar.set(SESSION_COOKIE, '', sessionCookie(null))
  redirect('/')
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
