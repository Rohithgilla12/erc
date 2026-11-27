'use server'

import { INTAKE_KEYS, type FieldErrors } from '@erc/domain'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { fieldsOf } from '@/content/form-fields'
import { currentCaller, run } from '@/members/run'

/** What was typed, so a refusal shows it again. Consent is never carried over a save: each save asks for it. */
export type IntakeFormState = {
  values: Readonly<Record<string, string>>
  shareWithCoach: boolean
  consent: boolean
  errors?: FieldErrors
  notice?: string
  saved?: boolean
}

export async function saveIntakeAction(_previous: IntakeFormState, form: FormData): Promise<IntakeFormState> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const fields = fieldsOf(form)
  // Only question fields become answers: a form post also carries the framework's own hidden fields.
  const values = Object.fromEntries(INTAKE_KEYS.map((key) => [key, fields[key] ?? '']))
  const state = { values, shareWithCoach: fields.shareWithCoach === 'on', consent: fields.consent === 'on' }
  const done = await run('saveIntake', caller, { answers: values, consent: fields.consent ?? '', shareWithCoach: fields.shareWithCoach ?? '' })
  if (!done.ok) {
    const { error } = done
    return error.code === 'invalid' ? { ...state, ...(error.fields ? { errors: error.fields } : {}) } : { ...state, notice: error.message }
  }
  revalidatePath('/me/intake')
  return { ...state, consent: false, saved: true }
}

export async function clearIntakeAction(_form: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('clearIntake', caller, {})
  revalidatePath('/me/intake')
  // A fresh value each time remounts the form, so answers typed before the delete do not linger in its state.
  redirect(`/me/intake?cleared=${Date.now()}`)
}
