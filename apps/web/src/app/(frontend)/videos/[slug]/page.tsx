import { contentPath, formatClockDuration, videoCategoryLabel, type Video } from '@erc/domain'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import React from 'react'

import { getVideo } from '@/content/learn'
import { clip } from '@/content/plain-text'
import { RichText } from '@/content/rich-text'
import { absoluteUrl } from '@/site-config'

import { formatDay } from '../../learn/_components/format'
import { Breadcrumbs, RelatedList } from '../../learn/_components/lists'
import { thumbnailPath, videoObject } from '../../learn/_components/structured-data'
import { breadcrumbList, JsonLd } from '../../structured-data'

import '../../learn/_components/learn.css'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ play?: string | string[] }> }

const videoOf = async (params: Props['params']) => {
  const video = await getVideo((await params).slug)
  if (!video) notFound()
  return video
}

const isPlaying = async (searchParams: Props['searchParams']) => (await searchParams).play === '1'

const categoryPath = (video: Pick<Video, 'category'>) => `/videos?category=${video.category}`

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const video = await videoOf(params)
  const description = clip(video.seo.description, 160)
  // The playing view is the same content plus YouTube's player, so only the plain page is indexed.
  const hidden = video.seo.noindex || (await isPlaying(searchParams))
  return {
    title: video.seo.title,
    description,
    alternates: { canonical: contentPath(video) },
    ...(hidden ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: 'video.other',
      title: video.seo.title,
      description,
      url: contentPath(video),
      images: [video.seo.imageUrl ?? absoluteUrl(thumbnailPath(video))],
    },
  }
}

export default async function VideoPage({ params, searchParams }: Props) {
  const [video, playing] = await Promise.all([videoOf(params), isPlaying(searchParams)])
  const category = videoCategoryLabel(video.category)
  const length = formatClockDuration(video.duration)
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Videos', path: '/videos' },
    { name: category, path: categoryPath(video) },
    { name: video.title, path: contentPath(video) },
  ]

  return (
    <article className="page article video-page">
      <JsonLd data={{ '@graph': [videoObject(video), breadcrumbList(crumbs)] }} />
      <header className="article-head">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{video.title}</h1>
        <p className="byline">
          <span>{length}</span>
          <span>
            Published <time dateTime={video.publishedAt}>{formatDay(video.publishedAt)}</time>
          </span>
        </p>
      </header>

      {playing ? (
        <div className="player">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        // A link rather than a script-driven facade: it works without JavaScript, and no YouTube code or image
        // request leaves the reader's browser until they ask to play.
        <a className="player player-facade" href={`${contentPath(video)}?play=1`} aria-label={`Play ${video.title}, ${length}`}>
          <Image unoptimized priority src={thumbnailPath(video)} alt="" width={480} height={360} />
          <span className="play-button" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
            </svg>
          </span>
          <span className="video-length">{length}</span>
        </a>
      )}
      <p className="player-note">
        {playing ? 'Playing from YouTube. ' : 'Plays from YouTube when you tap it. '}
        <a href={`https://www.youtube.com/watch?v=${video.youtubeId}`} rel="noopener">
          Open on YouTube
        </a>
      </p>

      <RichText value={video.description} className="prose article-body" />

      {video.transcript ? (
        <details className="transcript">
          <summary>Transcript</summary>
          <RichText value={video.transcript} className="prose" />
        </details>
      ) : null}

      {video.topics.length > 0 ? (
        <ul className="link-list topic-tags" aria-label="Topics">
          {video.topics.map((topic) => (
            <li key={topic.slug}>
              <a className="pill" href={`/learn/topic/${topic.slug}`}>
                {topic.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {video.related.length > 0 ? (
        <section className="article-section" aria-labelledby="related-heading">
          <h2 id="related-heading">Related articles</h2>
          <RelatedList links={video.related} />
        </section>
      ) : null}
    </article>
  )
}
