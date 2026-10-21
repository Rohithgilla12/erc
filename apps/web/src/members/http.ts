import config from '@payload-config'
import { API_BASE, operationFor, type ApiError, type Envelope } from '@erc/contract'
import type { RawInput } from '@erc/domain'
import { getPayload } from 'payload'

import { bearerCaller, run, STATUS } from './run'

const reply = (envelope: Envelope<unknown>) =>
  Response.json(envelope, { status: envelope.ok ? 200 : STATUS[envelope.error.code], headers: { 'cache-control': 'private, no-store' } })

const refuse = (error: ApiError) => reply({ ok: false, error })

const isJson = (request: Request) => /^application\/json\s*(?:;|$)/i.test(request.headers.get('content-type') ?? '')

const jsonObject = async (request: Request): Promise<RawInput | null> => {
  const body: unknown = await request.json().catch(() => null)
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as RawInput) : null
}

/**
 * Routes `/api/v1/<path>` to the operation with that method and path, authenticates with the bearer token alone, and
 * answers with the envelope. Pages and the API therefore run the same `run`, and the only difference is how the
 * caller and the input arrived. A POST must say it is JSON: a browser can send `text/plain` cross-origin without a
 * preflight, so refusing anything else keeps other people's browsers from spending this site's limits.
 */
export async function handleV1(request: Request, segments: readonly string[]): Promise<Response> {
  const path = `/${segments.join('/')}`
  const name = operationFor(request.method, path)
  if (!name) return refuse({ code: 'not_found', message: `No ${request.method} ${API_BASE}${path} in this API.` })
  if (request.method === 'POST' && !isJson(request)) return refuse({ code: 'unsupported_media_type', message: 'Send the body as application/json.' })
  try {
    const caller = await bearerCaller(request)
    const raw = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await jsonObject(request)
    if (!raw) return refuse({ code: 'invalid', message: 'Send a JSON object.' })
    return reply(await run(name, caller, raw))
  } catch (error) {
    ;(await getPayload({ config })).logger.error({ err: error, operation: name }, 'A v1 operation failed')
    return refuse({ code: 'unavailable', message: 'Something went wrong on our side. Please try again in a moment.' })
  }
}
