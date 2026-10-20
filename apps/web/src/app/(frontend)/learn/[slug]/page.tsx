import { contentPath, type Post } from '@erc/domain'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import React from 'react'

import { getPost } from '@/content/learn'
import { RichText } from '@/content/rich-text'
import { absoluteUrl } from '@/site-config'

import { formatDay, formatReadingTime, sameDay } from '../_components/format'
import { Breadcrumbs, RelatedList } from '../_components/lists'
import { breadcrumbList, JsonLd } from '../../structured-data'
import { article, coachPath } from '../_components/structured-data'

import '../_components/learn.css'

type Props = { params: Promise<{ slug: string }> }

const postOf = async (params: Props['params']) => {
  const post = await getPost((await params).slug)
  if (!post) notFound()
  return post
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await postOf(params)
  return {
    title: post.seo.title,
    description: post.seo.description,
    alternates: { canonical: contentPath(post) },
    ...(post.seo.noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: 'article',
      title: post.seo.title,
      description: post.seo.description,
      url: contentPath(post),
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: post.authors.map((coach) => absoluteUrl(coachPath(coach))),
      ...(post.seo.imageUrl ? { images: [post.seo.imageUrl] } : {}),
    },
  }
}

const crumbsOf = (post: Post) => [
  { name: 'Home', path: '/' },
  { name: 'Learn', path: '/learn' },
  ...(post.topics[0] ? [{ name: post.topics[0].title, path: `/learn/topic/${post.topics[0].slug}` }] : []),
  { name: post.title, path: contentPath(post) },
]

export default async function PostPage({ params }: Props) {
  const post = await postOf(params)
  const crumbs = crumbsOf(post)

  return (
    <article className="page article">
      <JsonLd data={{ '@graph': [article(post), breadcrumbList(crumbs)] }} />
      <header className="article-head">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{post.title}</h1>
        <p className="lede">{post.excerpt}</p>
        <p className="byline">
          {post.authors.length > 0 ? (
            <span>
              By{' '}
              {post.authors.map((coach, index) => (
                <React.Fragment key={coach.slug}>
                  {index > 0 ? (index === post.authors.length - 1 ? ' and ' : ', ') : null}
                  <a href={coachPath(coach)}>{coach.name}</a>
                </React.Fragment>
              ))}
            </span>
          ) : null}
          <span>
            Published <time dateTime={post.publishedAt}>{formatDay(post.publishedAt)}</time>
          </span>
          {sameDay(post.publishedAt, post.updatedAt) ? null : (
            <span>
              Updated <time dateTime={post.updatedAt}>{formatDay(post.updatedAt)}</time>
            </span>
          )}
          <span>{formatReadingTime(post.readingMinutes)}</span>
        </p>
        {post.topics.length > 0 ? (
          <ul className="link-list topic-tags" aria-label="Topics">
            {post.topics.map((topic) => (
              <li key={topic.slug}>
                <a className="pill" href={`/learn/topic/${topic.slug}`}>
                  {topic.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      {post.cover ? (
        <Image
          unoptimized
          priority
          className="article-cover"
          src={post.cover.url}
          alt={post.cover.alt}
          width={post.cover.width}
          height={post.cover.height}
        />
      ) : null}

      <RichText value={post.body} className="prose article-body" />

      {post.references.length > 0 ? (
        <section className="article-section" aria-labelledby="references-heading">
          <h2 id="references-heading">References</h2>
          <ol className="references">
            {post.references.map((reference) => (
              <li key={reference.url}>
                <a href={reference.url} rel="noopener">
                  {reference.title}
                </a>
                {reference.publisher ? <span className="reference-publisher">{reference.publisher}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {post.authors.length > 0 ? (
        <section className="article-section" aria-labelledby="authors-heading">
          <h2 id="authors-heading">{post.authors.length === 1 ? 'About the author' : 'About the authors'}</h2>
          <ul className="author-list">
            {post.authors.map((coach) => (
              <li key={coach.slug} className="author-box">
                {coach.photoUrl ? (
                  <Image unoptimized className="author-photo" src={coach.photoUrl} alt="" width={64} height={64} />
                ) : (
                  <span className="author-photo author-initial" aria-hidden="true">
                    {coach.name.charAt(0)}
                  </span>
                )}
                <div>
                  <h3>
                    <a href={coachPath(coach)}>{coach.name}</a>
                  </h3>
                  <p>{coach.credentials}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {post.related.length > 0 ? (
        <section className="article-section" aria-labelledby="related-heading">
          <h2 id="related-heading">Related</h2>
          <RelatedList links={post.related} />
        </section>
      ) : null}
    </article>
  )
}
