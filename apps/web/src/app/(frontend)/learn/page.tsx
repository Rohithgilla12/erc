import { parseListPage, withPageParam } from '@erc/domain'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import React from 'react'

import { findPosts, listTopics } from '@/content/learn'

import { Pagination, PostList } from './_components/lists'
import { collectionPage, JsonLd } from '../structured-data'

import './_components/learn.css'

type Props = { searchParams: Promise<{ page?: string | string[] }> }

const description = 'Articles from ERC coaches on training, pacing, heart rate, racing, strength, recovery and running in the heat.'

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parseListPage((await searchParams).page)
  return {
    title: page === 1 ? 'Learning centre' : `Learning centre, page ${page}`,
    description,
    alternates: { canonical: withPageParam('/learn', page) },
  }
}

export default async function LearnPage({ searchParams }: Props) {
  const page = parseListPage((await searchParams).page)
  const [topics, posts] = await Promise.all([listTopics(), findPosts(null, page)])
  // Temporary, because the page can exist again once more articles are published.
  if (posts.page !== page) redirect(withPageParam('/learn', posts.page))
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Learn', path: '/learn' },
  ]

  return (
    <div className="page learn">
      <JsonLd data={collectionPage({ name: 'Learning centre', description, path: withPageParam('/learn', page), crumbs })} />
      <header className="learn-head">
        <h1>Learning centre</h1>
        <p className="lede">{description}</p>
        <p>
          <a href="/videos">Browse the video library</a>
        </p>
      </header>

      {page === 1 ? (
        <section aria-labelledby="topics-heading">
          <h2 id="topics-heading" className="section-label">
            Topics
          </h2>
          <ul className="topic-grid">
            {topics.map((topic) => (
              <li key={topic.slug} className="topic-card">
                <h3>
                  <a href={`/learn/topic/${topic.slug}`}>{topic.title}</a>
                </h3>
                <p>{topic.description}</p>
                <p className="topic-count">{topic.postCount === 1 ? '1 article' : `${topic.postCount} articles`}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="latest-heading">
        <h2 id="latest-heading" className="section-label">
          {page === 1 ? 'Latest articles' : `Articles, page ${page}`}
        </h2>
        {posts.items.length === 0 ? <p className="empty-note">No articles yet.</p> : <PostList posts={posts.items} headingLevel="h3" />}
        <Pagination list={posts} href="/learn" />
      </section>
    </div>
  )
}
