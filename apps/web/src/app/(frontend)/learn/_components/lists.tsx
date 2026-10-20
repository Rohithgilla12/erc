import { contentPath, formatClockDuration, withPageParam, type ContentLink, type ListPage, type PostSummary, type VideoSummary } from '@erc/domain'
import Image from 'next/image'
import React from 'react'

import { formatDay, formatReadingTime, namesOf } from './format'
import { type Crumb } from '../../structured-data'

import { thumbnailPath } from './structured-data'

/** The trail above a page's title. Home is left out on screen; it is the logo's job, and it is in the JSON-LD. */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const trail = crumbs.slice(1, -1)
  if (trail.length === 0) return null
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((crumb) => (
          <li key={crumb.path}>
            <a href={crumb.path}>{crumb.name}</a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function PostList({ posts, headingLevel = 'h2' }: { posts: readonly PostSummary[]; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel
  return (
    <ol className="post-list">
      {posts.map((post) => (
        <li key={post.slug} className="post-card">
          {post.cover ? (
            <Image unoptimized className="post-card-cover" src={post.cover.url} alt="" width={post.cover.width} height={post.cover.height} loading="lazy" decoding="async" />
          ) : null}
          <div className="post-card-body">
            {post.topics[0] ? <p className="eyebrow">{post.topics[0].title}</p> : null}
            <Heading>
              <a href={contentPath(post)}>{post.title}</a>
            </Heading>
            <p className="post-card-excerpt">{post.excerpt}</p>
            <p className="byline">
              {post.authors.length > 0 ? <span>{namesOf(post.authors)}</span> : null}
              <time dateTime={post.publishedAt}>{formatDay(post.publishedAt)}</time>
              <span>{formatReadingTime(post.readingMinutes)}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export function VideoGrid({ videos, headingLevel = 'h2' }: { videos: readonly VideoSummary[]; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel
  return (
    <ol className="video-grid">
      {videos.map((video) => (
        <li key={video.slug} className="video-card">
          <div className="video-thumb">
            <Image unoptimized src={thumbnailPath(video)} alt="" width={480} height={360} loading="lazy" decoding="async" />
            <span className="video-length">{formatClockDuration(video.duration)}</span>
          </div>
          <Heading>
            <a href={contentPath(video)}>{video.title}</a>
          </Heading>
        </li>
      ))}
    </ol>
  )
}

const KIND_LABEL: Record<ContentLink['kind'], string> = { post: 'Article', video: 'Video', trainingPlan: 'Training plan', race: 'Race' }

export function RelatedList({ links }: { links: readonly ContentLink[] }) {
  return (
    <ul className="related-list">
      {links.map((link) => (
        <li key={`${link.kind}:${link.slug}`}>
          <span className="eyebrow">{KIND_LABEL[link.kind]}</span>
          <a href={contentPath(link)}>{link.title}</a>
        </li>
      ))}
    </ul>
  )
}

/** Previous and next as plain links, the same no-JavaScript pattern as the race calendar. */
export function Pagination({ list, href }: { list: ListPage<unknown>; href: string }) {
  if (list.totalPages <= 1) return null
  return (
    <nav className="pager" aria-label="Pages">
      {list.page > 1 ? (
        <a className="pill" href={withPageParam(href, list.page - 1)} rel="prev">
          Previous
        </a>
      ) : (
        <span />
      )}
      <span className="pager-status">{`Page ${list.page} of ${list.totalPages}`}</span>
      {list.page < list.totalPages ? (
        <a className="pill" href={withPageParam(href, list.page + 1)} rel="next">
          Next
        </a>
      ) : (
        <span />
      )}
    </nav>
  )
}
