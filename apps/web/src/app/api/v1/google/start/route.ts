import { NextResponse } from 'next/server'

import { absoluteUrl } from '@/site-config'
import { authorizeUrl, GOOGLE_HANDOFF_COOKIE, handoffCookie, newHandoff, sealHandoff } from '@/members/google'

export const dynamic = 'force-dynamic'

/** The sign-in page posts here with the "18 or over" box, so the declaration is made before anyone leaves for Google. */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData()
  if (form.get('over18') !== 'on') return NextResponse.redirect(absoluteUrl('/sign-in?google=age'), 303)
  const handoff = newHandoff(new Date())
  const url = authorizeUrl(handoff)
  if (!url) return NextResponse.redirect(absoluteUrl('/sign-in'), 303)
  const response = NextResponse.redirect(url, 303)
  response.cookies.set(GOOGLE_HANDOFF_COOKIE, sealHandoff(handoff), handoffCookie())
  return response
}
