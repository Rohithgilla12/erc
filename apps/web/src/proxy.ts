import { NextResponse, type NextRequest } from 'next/server'

// Payload names its auth cookie `<cookiePrefix>-token`, and the config keeps the default prefix.
const AUTH_COOKIE = 'payload-token'

/**
 * The only API paths a visitor without a credential needs: the admin's sign-in pages, uploaded images, script
 * revalidation, and the member API, which authenticates its own bearer tokens and answers 401 in its own error shape.
 */
const OPEN_PATHS = [
  /^\/api\/staff\/(?:login|logout|me|forgot-password|reset-password|first-register)$/,
  /^\/api\/[A-Za-z]+\/file\/[^/]+$/,
  /^\/api\/revalidate$/,
  /^\/api\/v1\//,
]

/**
 * Public pages read through the Local API, so the REST API serves only the admin and scripts. Anything else without a
 * credential gets 404, as if the API were not there. The gate checks only that a credential is present: Payload still
 * verifies it and applies access control, so a forged cookie reads no more than an anonymous visitor may.
 */
export function proxy(request: NextRequest) {
  const credentialed = request.cookies.has(AUTH_COOKIE) || request.headers.has('authorization')
  if (credentialed || OPEN_PATHS.some((path) => path.test(request.nextUrl.pathname))) return NextResponse.next()
  return Response.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })
}

export const config = { matcher: '/api/:path*' }
