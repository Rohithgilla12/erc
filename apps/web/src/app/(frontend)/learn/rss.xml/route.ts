import { contentPath, type PostSummary } from '@erc/domain'

import { feedPosts } from '@/content/learn'
import { absoluteUrl } from '@/site-config'

import { CLUB } from '../../site-nav'
import { FEED_PATH, FEED_TITLE } from '../_components/feed'

// Built per request: the image is built without a database, and the feed changes with every publish.
export const dynamic = 'force-dynamic'

// XML 1.0 forbids these characters even when escaped, so one pasted into a title would make the whole feed invalid.
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

const text = (value: string) => value.replace(FORBIDDEN, '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

const rfc822 = (instant: string) => new Date(instant).toUTCString()

const item = (post: PostSummary) => {
  const link = text(absoluteUrl(contentPath(post)))
  return `    <item>
      <title>${text(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${rfc822(post.publishedAt)}</pubDate>
      <description>${text(post.excerpt)}</description>
    </item>`
}

/** The newest published articles that are not hidden from search engines: title, link, date and excerpt only, so a reader comes to the site for the article. */
export async function GET() {
  const items = await feedPosts()
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${text(FEED_TITLE)}</title>
    <link>${text(absoluteUrl('/learn'))}</link>
    <description>${text(CLUB.description)}</description>
    <language>en-IN</language>
    <atom:link href="${text(absoluteUrl(FEED_PATH))}" rel="self" type="application/rss+xml" />
${items.map(item).join('\n')}
  </channel>
</rss>
`
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } })
}
