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
