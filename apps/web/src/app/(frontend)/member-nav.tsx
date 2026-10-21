import { connection } from 'next/server'
import React from 'react'

import { currentCaller, signInOpen } from '@/members/run'

/** One link: "Sign in" while sign-in is open, "My running" once signed in, nothing otherwise. Decided per request. */
export async function MemberNav() {
  await connection()
  const caller = await currentCaller()
  if (caller.kind === 'member') {
    return (
      <a className="member-link" href="/me">
        My running
      </a>
    )
  }
  return signInOpen() ? (
    <a className="member-link" href="/sign-in">
      Sign in
    </a>
  ) : null
}
