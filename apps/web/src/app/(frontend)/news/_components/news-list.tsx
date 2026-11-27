import type { LocalDate } from '@erc/domain'
import React from 'react'

import { newsPath, type NewsItem } from '@/content/news'

import './news.css'

// A LocalDate is a calendar fact, so it is formatted at UTC midnight to keep the day from shifting.
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const formatNewsDay = (date: LocalDate) => dayFormat.format(new Date(`${date}T00:00:00Z`))

/** The date and the source on one ruled line, the way a clipping is filed. */
export function NewsMeta({ item }: { item: NewsItem }) {
  return (
    <p className="news-meta">
      <time dateTime={item.publishedOn}>{formatNewsDay(item.publishedOn)}</time>
      <span>{item.sourceName}</span>
      {item.race ? (
        <span>
          About <a href={`/races/${item.race.slug}`}>{item.race.name}</a>
        </span>
      ) : null}
    </p>
  )
}

export function NewsList({ items, headingLevel }: { items: readonly NewsItem[]; headingLevel: 'h2' | 'h3' }) {
  const Heading = headingLevel
  return (
    <ol className="news-list">
      {items.map((item) => (
        <li key={item.id} className="news-item">
          <Heading>
            <a href={newsPath(item)}>{item.headline}</a>
          </Heading>
          <p className="news-summary">{item.summary}</p>
          <NewsMeta item={item} />
        </li>
      ))}
    </ol>
  )
}
