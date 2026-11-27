'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { currentCaller, run } from '@/members/run'

export async function syncStravaAction(_formData?: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('syncStrava', caller, {})
  revalidatePath('/me')
}

export async function disconnectStravaAction(_formData?: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('disconnectStrava', caller, {})
  revalidatePath('/me')
}

export async function joinStravaWaitlistAction(_formData?: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  await run('joinStravaWaitlist', caller, {})
  revalidatePath('/me')
}

/** The outcome travels back in the query string, so the form needs no client state and works without JavaScript. */
export async function setHomeCityAction(formData: FormData): Promise<void> {
  const caller = await currentCaller()
  if (caller.kind !== 'member') redirect('/sign-in')
  const saved = await run('setHomeCity', caller, { city: String(formData.get('city') ?? '') })
  revalidatePath('/me')
  redirect(`/me?city=${saved.ok ? 'saved' : 'invalid'}#home-city`)
}
