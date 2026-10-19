import { timingSafeEqual } from 'node:crypto'

import { revalidateTag } from 'next/cache'
import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  Endpoint,
  Payload,
  PayloadRequest,
} from 'payload'

import { siteConfig } from '../site-config'

import { EDITORIAL_SLUGS, RECORD_SLUGS, type ErcSlug } from './slugs'

declare module 'payload' {
  interface RequestContext {
    /** Set by bulk writers, such as the seed script, that refresh the site once at the end instead of per document. */
    skipRevalidation?: boolean
  }
}

/** One tag per collection: reads tag with it and every write to the collection expires it. */
export const collectionTag = (slug: ErcSlug) => `collection:${slug}`

const KNOWN_TAGS = new Set([...EDITORIAL_SLUGS, ...RECORD_SLUGS].map(collectionTag))

// Expire now rather than serve stale-while-revalidate: an editor who saves expects the next page view to show it.
const expireNow = (tags: readonly string[]) => tags.forEach((tag) => revalidateTag(tag, { expire: 0 }))

// Next's code for "static generation store missing": `revalidateTag` was called outside a request Next is serving.
const NO_REQUEST_STORE = 'E263'
const outsideNextRequest = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE === NO_REQUEST_STORE

/**
 * Expires the tags in-process when Next allows it (REST, GraphQL, and the admin all write inside a request), and
 * otherwise asks the running server over HTTP. Never throws: the document is already written when this runs, so an
 * error here would fail a write that succeeded. Outside a request, as in a `payload run` script, the fallback is
 * expected; any other refusal from Next, such as a write during render, is logged as a warning.
 */
const revalidate = async (req: PayloadRequest, tags: readonly string[]) => {
  if (req.context.skipRevalidation) return
  try {
    expireNow(tags)
  } catch (error) {
    if (outsideNextRequest(error)) req.payload.logger.debug({ tags }, 'Outside a Next.js request; asking the running site to revalidate')
    else req.payload.logger.warn({ tags, err: error }, 'In-process revalidation failed; asking the running site to revalidate')
    await refreshRunningSite(req.payload, tags)
  }
}

export const revalidateOnChange =
  (slug: ErcSlug): CollectionAfterChangeHook =>
  async ({ doc, req }) => {
    await revalidate(req, [collectionTag(slug)])
    return doc
  }

export const revalidateOnDelete =
  (slug: ErcSlug): CollectionAfterDeleteHook =>
  async ({ req }) => {
    await revalidate(req, [collectionTag(slug)])
  }

const REVALIDATE_PATH = '/revalidate'

/** Never throws: the write has already succeeded, and a stale page is better than a rolled-back edit. */
export const refreshRunningSite = async (payload: Payload, tags: readonly string[]) => {
  try {
    const { siteUrl, revalidateSecret: secret } = siteConfig()
    if (!secret) {
      payload.logger.warn({ tags }, 'Not revalidating: set REVALIDATE_SECRET so scripts refresh the running site')
      return
    }
    const response = await fetch(new URL(`/api${REVALIDATE_PATH}`, siteUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) payload.logger.warn({ tags, status: response.status }, 'The running site refused to revalidate')
  } catch (error) {
    payload.logger.warn({ tags, err: error }, 'Could not ask the running site to revalidate')
  }
}

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** `POST /api/revalidate` with `{ "tags": [...] }`, for writers outside the server process. */
export const revalidateEndpoint: Endpoint = {
  path: REVALIDATE_PATH,
  method: 'post',
  handler: async (req) => {
    const secret = siteConfig().revalidateSecret
    if (!secret || !sameSecret(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body: unknown = await req.json?.().catch(() => null)
    const tags = (body as { tags?: unknown } | null)?.tags
    if (!Array.isArray(tags) || tags.length === 0 || !tags.every((tag) => KNOWN_TAGS.has(tag))) {
      return Response.json({ error: 'Send {"tags": [...]} with known collection tags' }, { status: 400 })
    }
    expireNow(tags)
    return Response.json({ revalidated: tags })
  },
}
