import { NextResponse } from 'next/server'

import { authorizeUrl, GOOGLE_HANDOFF_COOKIE, handoffCookie, newHandoff, sealHandoff } from '@/members/google'
import { absoluteUrl, siteConfig } from '@/site-config'

export const dynamic = 'force-dynamic'

/**
 * The sign-in page posts here with the "18 or over" box, so the declaration is made before anyone leaves for Google.
 * Browsers send `Origin` on every form post; requiring ours means another site cannot submit the box for a visitor.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== siteConfig().siteUrl.origin) return new Response('Forbidden', { status: 403 })
  const form = await request.formData().catch(() => null)
  if (form?.get('over18') !== 'on') return NextResponse.redirect(absoluteUrl('/sign-in?google=age'), 303)
  const handoff = newHandoff(new Date())
  const url = authorizeUrl(handoff)
  if (!url) return NextResponse.redirect(absoluteUrl('/sign-in'), 303)
  const response = NextResponse.redirect(url, 303)
  response.cookies.set(GOOGLE_HANDOFF_COOKIE, sealHandoff(handoff), handoffCookie())
  return response
}
