/**
 * Proves an expired tag drops a cached read at once on a server whose wall clock runs ahead of its monotonic clock,
 * which every long-running server reaches once the system clock is corrected: `pnpm payload run src/scripts/check-tag-expiry.ts`.
 * Needs no site and no database. It fails if `patches/next@16.3.3.patch` is missing, or lost in a Next.js upgrade
 * that still times tags with two clocks.
 */
import fileSystemCacheModule from 'next/dist/server/lib/incremental-cache/file-system-cache'
import { nodeFs } from 'next/dist/server/lib/node-fs-methods'
import type { CachedFetchValue, CachedRouteKind, IncrementalCacheKind } from 'next/dist/server/response-cache'

// Next ships CommonJS, so Node hands an ES module the whole `module.exports` and the class is its `default`.
const { default: FileSystemCache } = fileSystemCacheModule as unknown as { default: typeof fileSystemCacheModule }

const failures: string[] = []

const expect = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const cache = new FileSystemCache({
  fs: nodeFs,
  flushToDisk: false,
  serverDistDir: '',
  maxMemoryCacheSize: 1_000_000,
  revalidatedTags: [],
  _requestHeaders: {},
})
const FETCH = 'FETCH' as CachedRouteKind.FETCH & IncrementalCacheKind.FETCH

const value: CachedFetchValue = {
  kind: FETCH,
  data: { headers: {}, body: '"cached"', status: 200, url: '' },
  revalidate: 3600,
}

const cachedAfterExpiry = async (wallClockLeadMs: number) => {
  const wallClock = Date.now
  Date.now = () => wallClock() + wallClockLeadMs
  try {
    const tag = `check-tag-expiry:${wallClockLeadMs}`
    const read = () => cache.get(tag, { kind: FETCH, revalidate: 3600, fetchUrl: '', fetchIdx: 0, tags: [tag], softTags: [] })
    await cache.set(tag, value, { fetchCache: true, tags: [tag] })
    const before = await read()
    // A cached read cannot be written and expired in the same millisecond on a real server; the tag must be the later.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await cache.revalidateTag([tag], { expire: 0 })
    return { before: before !== null, after: (await read()) !== null }
  } finally {
    Date.now = wallClock
  }
}

for (const lead of [0, 50, 60_000]) {
  const { before, after } = await cachedAfterExpiry(lead)
  expect(`with the wall clock ${lead} ms ahead, a cached read is served before its tag expires`, before)
  expect(`with the wall clock ${lead} ms ahead, the read is gone as soon as its tag expires`, !after)
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('All tag expiry checks passed')
process.exit(0)
