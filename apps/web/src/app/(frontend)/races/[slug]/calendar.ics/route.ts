import { toIcs } from '@erc/domain'

import { getRace } from '@/content/races'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const race = await getRace(slug)
  if (!race) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  return new Response(toIcs(race), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${race.slug}.ics"`,
    },
  })
}
