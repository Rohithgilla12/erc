import { describe, expect, it } from 'vitest'
import { API_BASE, createClient, OPERATION_NAMES, OPERATIONS, operationFor, STATUS, type FetchLike, type SessionToken } from './index'

type Call = Parameters<FetchLike>

const recordingFetch = (reply: unknown, status = 200) => {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push([url, init])
    return { status, json: async () => reply }
  }
  return { calls, fetch }
}

describe('OPERATIONS', () => {
  it('maps every method and path to exactly one operation', () => {
    for (const name of OPERATION_NAMES) {
      const { method, path } = OPERATIONS[name]
      expect(operationFor(method, path)).toBe(name)
    }
    expect(operationFor('GET', '/auth/code')).toBeNull()
    expect(operationFor('DELETE', '/me/runs')).toBeNull()
  })

  it('has a status for every error code', () => {
    expect(STATUS.unauthenticated).toBe(401)
    expect(STATUS.invalid).toBe(422)
    expect(STATUS.rate_limited).toBe(429)
  })
})

describe('createClient', () => {
  it('posts JSON with the bearer token, under the versioned base', async () => {
    const { calls, fetch } = recordingFetch({ ok: true, data: { sent: true } })
    const client = createClient({ baseUrl: 'https://erc.example', token: async () => 'erc_abc' as SessionToken, fetch })
    const reply = await client.signInStart({ email: 'asha@example.com', over18: true })
    expect(reply).toEqual({ ok: true, data: { sent: true } })
    const [url, init] = calls[0]!
    expect(url).toBe(`https://erc.example${API_BASE}/auth/code`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer erc_abc', 'content-type': 'application/json' })
    expect(JSON.parse(init.body ?? '')).toEqual({ email: 'asha@example.com', over18: true })
  })

  it('sends GET input as a query string, leaving out empty values, and no authorization header without a token', async () => {
    const { calls, fetch } = recordingFetch({ ok: true, data: { items: [], next: null } })
    const client = createClient({ baseUrl: 'https://erc.example', token: async () => null, fetch })
    await client.listRuns({ after: 'c1' })
    await client.listRuns({ after: '' })
    expect(calls[0]![0]).toBe(`https://erc.example${API_BASE}/me/runs?after=c1`)
    expect(calls[1]![0]).toBe(`https://erc.example${API_BASE}/me/runs`)
    expect(calls[0]![1].body).toBeUndefined()
    expect('authorization' in calls[0]![1].headers).toBe(false)
  })

  it('turns a reply that is not an envelope into an unavailable error', async () => {
    const { fetch } = recordingFetch('<html>gateway</html>', 502)
    const client = createClient({ baseUrl: 'https://erc.example', token: async () => null, fetch })
    expect(await client.dashboard({})).toEqual({ ok: false, error: { code: 'unavailable', message: 'The server answered 502 without a result.' } })
  })

  it('passes a server error envelope through unchanged', async () => {
    const error = { code: 'unauthenticated', message: 'Sign in to continue.' }
    const { fetch } = recordingFetch({ ok: false, error }, 401)
    const client = createClient({ baseUrl: 'https://erc.example', token: async () => null, fetch })
    expect(await client.dashboard({})).toEqual({ ok: false, error })
  })
})
