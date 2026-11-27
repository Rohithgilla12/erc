import { parseListPage, withPageParam } from '@erc/domain'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import React from 'react'

import { findNews } from '@/content/news'

import { Pagination } from '../learn/_components/lists'
import { collectionPage, JsonLd } from '../structured-data'

import { NEWS_FEED_PATH } from './_components/feed'
import { NewsList } from './_components/news-list'

import '../learn/_components/learn.css'

type Props = { searchParams: Promise<{ page?: string | string[] }> }

const description = 'Running news for club runners in India, picked and summarised by ERC, with a link to each original story.'

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parseListPage((await searchParams).page)
  return {
    title: page === 1 ? 'News' : `News, page ${page}`,
    description,
    alternates: { canonical: withPageParam('/news', page), types: { 'application/rss+xml': NEWS_FEED_PATH } },
  }
}

export default async function NewsPage({ searchParams }: Props) {
  const page = parseListPage((await searchParams).page)
  const news = await findNews(page)
  // Temporary, because the page can exist again once more news is published.
  if (news.page !== page) redirect(withPageParam('/news', news.page))
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'News', path: '/news' },
  ]

  return (
    <div className="page news">
      <JsonLd data={collectionPage({ name: 'News', description, path: withPageParam('/news', page), crumbs })} />
      <header className="news-head">
        <h1>{page === 1 ? 'News' : `News, page ${page}`}</h1>
        <p className="lede">{description}</p>
        <p>
          <a href={NEWS_FEED_PATH}>Follow the news by RSS</a>
        </p>
      </header>
      {news.items.length === 0 ? <p className="empty-note">No news yet.</p> : <NewsList items={news.items} headingLevel="h2" />}
      <Pagination list={news} href="/news" />
    </div>
  )
}
