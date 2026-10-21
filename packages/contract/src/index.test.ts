import { describe, expect, it } from 'vitest'
import type { Instant, LocalDate, SourceRef } from '@erc/domain'
import { API_BASE, createClient, encodeRunCursor, OPERATION_NAMES, OPERATIONS, operationFor, parseRunCursor, STATUS, type FetchLike, type SessionToken } from './index'

declare const btoa: (text: string) => string
declare const Blob: new (parts: string[], options: { type: string }) => { size: number; type: string }
declare const FormData: new () => { get(name: string): unknown }

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

  it('lets only a signed-in member near athlete profiles', () => {
    const athleteOps = OPERATION_NAMES.filter((name) => OPERATIONS[name].path.startsWith('/me/athlete'))
    expect(athleteOps).toEqual(['myAthlete', 'searchAthletes', 'claimAthlete', 'startAthlete', 'updateProfile', 'setPhoto', 'setVisibility'])
    expect(athleteOps.map((name) => OPERATIONS[name].access)).toEqual(athleteOps.map(() => 'member'))
  })

  it('takes profile edits through the domain table, so a member cannot name the link, consent, or a photo here', () => {
    expect(OPERATIONS.updateProfile.parse({ city: 'Pune', member: 4, visibility: { profile: 'public' }, photo: 3 })).toEqual({ ok: true, value: { city: 'Pune' } })
  })

  it('has a status for every error code', () => {
    expect(STATUS.unauthenticated).toBe(401)
    expect(STATUS.invalid).toBe(422)
    expect(STATUS.unsupported_media_type).toBe(415)
    expect(STATUS.rate_limited).toBe(429)
  })
})

describe('run cursors', () => {
  const run = { on: '2026-10-20' as LocalDate, loggedAt: '2026-10-20T12:34:56.789Z' as Instant, ref: '3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c' as SourceRef }
  const encode = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  it('round-trips, and listRuns parses it into the sort key', () => {
    const cursor = encodeRunCursor(run)
    expect(parseRunCursor(cursor)).toEqual({ ok: true, value: run })
    expect(OPERATIONS.listRuns.parse({ after: cursor })).toEqual({ ok: true, value: { after: run } })
    expect(OPERATIONS.listRuns.parse({})).toEqual({ ok: true, value: { after: null } })
    expect(OPERATIONS.listRuns.parse({ after: '' })).toEqual({ ok: true, value: { after: null } })
  })

  it.each([
    ['a timestamp the database would choke on', encode('2026-01-01|1|3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c')],
    ['month 13', encode('2026-13-01|2026-10-20T12:34:56.789Z|3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c')],
    ['a date that only looks right', encode('2026-02-30|2026-10-20T12:34:56.789Z|3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c')],
    ['an instant not written as the server writes them', encode('2026-10-20|2026-10-20 12:34:56|3f2a1c4e-9b7d-4e1a-8c2b-5d6e7f8a9b0c')],
    ['a ref that is not a source ref', encode('2026-10-20|2026-10-20T12:34:56.789Z|x')],
    ['two parts', encode('2026-10-20|2026-10-20T12:34:56.789Z')],
    ['not base64url', 'not a cursor!'],
    ['nothing after decoding', 'AA'],
    ['one character', 'A'],
    ['a length atob refuses', 'AAAAA'],
  ])('refuses %s as a field error on `after`', (_label, after) => {
    expect(parseRunCursor(after)).toEqual({ ok: false, error: 'not_a_cursor' })
    expect(OPERATIONS.listRuns.parse({ after })).toEqual({ ok: false, error: { after: 'That page link is not valid. Start again from the newest runs.' } })
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
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '')).toEqual({ email: 'asha@example.com', over18: true })
  })

  it('sends a photo as multipart and leaves the content type to fetch, which writes the boundary', async () => {
    const { calls, fetch } = recordingFetch({ ok: true, data: { kind: 'none', rejectedClaim: null } })
    const client = createClient({ baseUrl: 'https://erc.example', token: async () => 'erc_abc' as SessionToken, fetch })
    const photo = new Blob(['png'], { type: 'image/png' })
    await client.setPhoto({ photo })
    const [url, init] = calls[0]!
    expect(url).toBe(`https://erc.example${API_BASE}/me/athlete/photo`)
    expect('content-type' in init.headers).toBe(false)
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as unknown as InstanceType<typeof FormData>).get('photo')).toBeInstanceOf(Blob)
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
