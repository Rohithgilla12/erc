'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { fieldsOf } from './form-fields'
import { confirmSubscription, receiveSignup, unsubscribe, type SignupFormState } from './newsletter'

export async function submitSignup(_previous: SignupFormState, form: FormData): Promise<SignupFormState> {
  return receiveSignup(fieldsOf(form), await headers())
}

const tokenOf = (form: FormData) => {
  const token = form.get('token')
  return typeof token === 'string' ? token : ''
}

/** A link that did not confirm goes back to its own page, which then explains why. */
export async function confirmFromLink(form: FormData) {
  const token = tokenOf(form)
  const state = await confirmSubscription(token)
  redirect(state === 'valid' ? '/newsletter/confirm?status=confirmed' : `/newsletter/confirm?token=${encodeURIComponent(token)}`)
}

export async function unsubscribeFromLink(form: FormData) {
  const token = tokenOf(form)
  redirect((await unsubscribe(token)) ? '/newsletter/unsubscribe?status=done' : `/newsletter/unsubscribe?token=${encodeURIComponent(token)}`)
}
