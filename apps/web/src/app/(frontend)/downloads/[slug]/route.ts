import { ANONYMOUS, canAccess } from '@erc/domain'

import { downloadFilename, findDownload } from '@/content/resources'

const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })

/**
 * The only public way to a downloadable file. Phase 3 reads the viewer from the member session and changes what
 * `canAccess` allows; this URL, and every link to it, stays the same.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const download = await findDownload((await params).slug)
  if (!download) return notFound()
  const { resource } = download
  // Answering 404 rather than 403 keeps a refused file indistinguishable from a missing one.
  if (!canAccess(ANONYMOUS, resource.access)) return notFound()
  const file = await download.open()
  return new Response(file.body, {
    headers: {
      'content-type': resource.file.mimeType,
      ...(file.bytes === null ? {} : { 'content-length': String(file.bytes) }),
      'content-disposition': `attachment; filename="${downloadFilename(resource)}"`,
      'x-content-type-options': 'nosniff',
      // Never stored by Cloudflare or another shared cache, so a file that later becomes paid cannot linger there.
      'cache-control': 'private, no-cache',
    },
  })
}
