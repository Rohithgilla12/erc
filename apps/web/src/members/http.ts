import { API_BASE, operationFor, type ApiError, type Envelope } from '@erc/contract'
import type { RawInput } from '@erc/domain'

import { bearerCaller, run, STATUS } from './run'

const reply = (envelope: Envelope<unknown>) =>
  Response.json(envelope, { status: envelope.ok ? 200 : STATUS[envelope.error.code], headers: { 'cache-control': 'private, no-store' } })

const refuse = (error: ApiError) => reply({ ok: false, error })

const jsonObject = async (request: Request): Promise<RawInput | null> => {
  const body: unknown = await request.json().catch(() => null)
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as RawInput) : null
}

/**
 * Routes `/api/v1/<path>` to the operation with that method and path, authenticates with the bearer token alone, and
 * answers with the envelope. Pages and the API therefore run the same `run`, and the only difference is how the
 * caller and the input arrived.
 */
export async function handleV1(request: Request, segments: readonly string[]): Promise<Response> {
  const path = `/${segments.join('/')}`
  const name = operationFor(request.method, path)
  if (!name) return refuse({ code: 'not_found', message: `No ${request.method} ${API_BASE}${path} in this API.` })
  const caller = await bearerCaller(request)
  if (!caller) return refuse({ code: 'unauthenticated', message: 'That token is not valid. Sign in again.' })
  const raw = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await jsonObject(request)
  if (!raw) return refuse({ code: 'invalid', message: 'Send a JSON object.' })
  return reply(await run(name, caller, raw))
}
