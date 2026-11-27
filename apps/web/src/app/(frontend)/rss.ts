import { absoluteUrl } from '@/site-config'

import { CLUB } from './site-nav'

// XML 1.0 forbids these characters even when escaped, so one pasted into a title would make the whole feed invalid.
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

const text = (value: string) => value.replace(FORBIDDEN, '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

const rfc822 = (instant: string) => new Date(instant).toUTCString()

export type FeedItem = { title: string; path: string; publishedAt: string; description: string }

const item = ({ title, path, publishedAt, description }: FeedItem) => {
  const link = text(absoluteUrl(path))
  return `    <item>
      <title>${text(title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${rfc822(publishedAt)}</pubDate>
      <description>${text(description)}</description>
    </item>`
}

/** An RSS 2.0 feed of title, link, date and summary only, so a reader comes to the site for the rest. */
export const rssResponse = ({ title, path, selfPath, items }: { title: string; path: string; selfPath: string; items: readonly FeedItem[] }) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${text(title)}</title>
    <link>${text(absoluteUrl(path))}</link>
    <description>${text(CLUB.description)}</description>
    <language>en-IN</language>
    <atom:link href="${text(absoluteUrl(selfPath))}" rel="self" type="application/rss+xml" />
${items.map(item).join('\n')}
  </channel>
</rss>
`
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } })
}
