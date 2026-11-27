import { findNews, newsPath } from '@/content/news'

import { rssResponse } from '../../rss'
import { NEWS_FEED_PATH, NEWS_FEED_TITLE } from '../_components/feed'

// Built per request: the image is built without a database, and the feed changes with every publish.
export const dynamic = 'force-dynamic'

/** The newest page of news; each item's date is the day its source published it. */
export async function GET() {
  const { items } = await findNews(1)
  return rssResponse({
    title: NEWS_FEED_TITLE,
    path: '/news',
    selfPath: NEWS_FEED_PATH,
    items: items.map((item) => ({ title: item.headline, path: newsPath(item), publishedAt: `${item.publishedOn}T00:00:00+05:30`, description: item.summary })),
  })
}
