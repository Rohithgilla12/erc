import { getVideo, youtubeThumbnail } from '@/content/learn'

type Context = { params: Promise<{ slug: string }> }

// Shown when YouTube has no thumbnail, as for a removed video, so the page never shows a broken-image glyph.
const FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270"><rect width="480" height="270" fill="#1b1b19"/></svg>`

/** Serves a published video's YouTube thumbnail from this site, so the video page makes no request to YouTube. */
export async function GET(_request: Request, { params }: Context) {
  const video = await getVideo((await params).slug)
  if (!video) return new Response('Not found', { status: 404 })
  const upstream = await youtubeThumbnail(video.youtubeId)
  if (!upstream) {
    return new Response(FALLBACK, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' } })
  }
  return new Response(await upstream.arrayBuffer(), {
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'public, max-age=86400' },
  })
}
