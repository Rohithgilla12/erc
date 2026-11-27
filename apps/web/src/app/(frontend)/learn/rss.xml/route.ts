import { contentPath } from '@erc/domain'

import { feedPosts } from '@/content/learn'

import { rssResponse } from '../../rss'
import { FEED_PATH, FEED_TITLE } from '../_components/feed'

// Built per request: the image is built without a database, and the feed changes with every publish.
export const dynamic = 'force-dynamic'

/** The newest published articles that are not hidden from search engines. */
export async function GET() {
  const posts = await feedPosts()
  return rssResponse({
    title: FEED_TITLE,
    path: '/learn',
    selfPath: FEED_PATH,
    items: posts.map((post) => ({ title: post.title, path: contentPath(post), publishedAt: post.publishedAt, description: post.excerpt })),
  })
}
