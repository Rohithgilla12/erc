import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import { getNewsItem, newsPath } from '@/content/news'

import { breadcrumbList, JsonLd } from '../../structured-data'
import { NewsMeta } from '../_components/news-list'

type Props = { params: Promise<{ slug: string }> }

const itemOf = async (params: Props['params']) => {
  const item = await getNewsItem((await params).slug)
  if (!item) notFound()
  return item
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await itemOf(params)
  return {
    title: item.headline,
    description: item.summary,
    alternates: { canonical: newsPath(item) },
    openGraph: { type: 'article', title: item.headline, description: item.summary, url: newsPath(item), modifiedTime: item.updatedAt },
  }
}

export default async function NewsItemPage({ params }: Props) {
  const item = await itemOf(params)
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'News', path: '/news' },
    { name: item.headline, path: newsPath(item) },
  ]
  return (
    <article className="page news">
      <JsonLd data={{ '@graph': [breadcrumbList(crumbs)] }} />
      <header className="news-head">
        <p>
          <a href="/news">News</a>
        </p>
        <h1>{item.headline}</h1>
        <NewsMeta item={item} />
      </header>
      <div className="news-body">
        <p>{item.summary}</p>
        <p className="news-source">
          <a className="button" href={item.sourceUrl} rel="noopener">
            Read the full story at {item.sourceName}
          </a>
          {item.race ? <a href={`/races/${item.race.slug}`}>See {item.race.name} in the calendar</a> : null}
        </p>
      </div>
    </article>
  )
}
