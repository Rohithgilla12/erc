import { parseListPage, withPageParam } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { findPosts, getTopic } from '@/content/learn'

import { Breadcrumbs, Pagination, PostList } from '../../_components/lists'
import { breadcrumbList, JsonLd } from '../../_components/structured-data'

import '../../_components/learn.css'

type Props = { params: Promise<{ topic: string }>; searchParams: Promise<{ page?: string | string[] }> }

const topicOf = async (params: Props['params']) => {
  const topic = await getTopic((await params).topic)
  if (!topic) notFound()
  return topic
}

const pathOf = (slug: string) => `/learn/topic/${slug}`

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const topic = await topicOf(params)
  const page = parseListPage((await searchParams).page)
  return {
    title: page === 1 ? topic.title : `${topic.title}, page ${page}`,
    description: topic.description,
    alternates: { canonical: withPageParam(pathOf(topic.slug), page) },
  }
}

export default async function TopicPage({ params, searchParams }: Props) {
  const topic = await topicOf(params)
  const page = parseListPage((await searchParams).page)
  const posts = await findPosts({ kind: 'topic', id: topic.id }, page)
  if (posts.page !== page) redirect(withPageParam(pathOf(topic.slug), posts.page))
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Learn', path: '/learn' },
    { name: topic.title, path: pathOf(topic.slug) },
  ]

  return (
    <div className="page learn">
      <JsonLd
        data={{ '@graph': [{ '@type': 'CollectionPage', name: topic.title, description: topic.description }, breadcrumbList(crumbs)] }}
      />
      <header className="learn-head">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{topic.title}</h1>
        <p className="lede">{topic.description}</p>
      </header>
      <section aria-label="Articles">
        {posts.items.length === 0 ? (
          <p className="empty-note">
            No articles in this topic yet. <a href="/learn">See every topic</a>.
          </p>
        ) : (
          <PostList posts={posts.items} />
        )}
        <Pagination list={posts} href={pathOf(topic.slug)} />
      </section>
    </div>
  )
}
