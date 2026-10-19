import { parseListPage, parseVideoCategory, videoCategoryLabel, withPageParam, type VideoCategory } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { findVideos, listVideoShelves } from '@/content/learn'

import { Breadcrumbs, Pagination, VideoGrid } from '../learn/_components/lists'
import { breadcrumbList, JsonLd } from '../learn/_components/structured-data'

import '../learn/_components/learn.css'

type Props = { searchParams: Promise<{ category?: string | string[]; page?: string | string[] }> }

const description = 'Technique, coach explainers, strength sessions, race preparation, group runs and runner interviews from ERC.'

/** No category is the shelf view; an unknown category is a 404 rather than a silent fallback. */
const readView = async (searchParams: Props['searchParams']) => {
  const params = await searchParams
  const page = parseListPage(params.page)
  if (params.category === undefined) return { category: null, page: 1 }
  const category = typeof params.category === 'string' ? parseVideoCategory(params.category) : null
  if (!category) notFound()
  return { category, page }
}

const categoryPath = (category: VideoCategory) => `/videos?category=${category}`

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { category, page } = await readView(searchParams)
  if (!category) return { title: 'Video library', description, alternates: { canonical: '/videos' } }
  const label = videoCategoryLabel(category)
  return {
    title: page === 1 ? `${label} videos` : `${label} videos, page ${page}`,
    description: `${label}: videos from ERC coaches and runners.`,
    alternates: { canonical: withPageParam(categoryPath(category), page) },
  }
}

export default async function VideosPage({ searchParams }: Props) {
  const { category, page } = await readView(searchParams)
  return category ? <CategoryView category={category} page={page} /> : <ShelfView />
}

async function ShelfView() {
  const shelves = await listVideoShelves()
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Videos', path: '/videos' },
  ]
  return (
    <div className="page learn">
      <JsonLd data={{ '@graph': [{ '@type': 'CollectionPage', name: 'Video library', description }, breadcrumbList(crumbs)] }} />
      <header className="learn-head">
        <h1>Video library</h1>
        <p className="lede">{description}</p>
        {shelves.length > 1 ? (
          <ul className="link-list" aria-label="Categories">
            {shelves.map(({ category }) => (
              <li key={category}>
                <a className="pill" href={`#${category}`}>
                  {videoCategoryLabel(category)}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      {shelves.length === 0 ? <p className="empty-note">No videos yet.</p> : null}
      {shelves.map((shelf) => (
        <section key={shelf.category} id={shelf.category} className="shelf" aria-labelledby={`${shelf.category}-heading`}>
          <div className="shelf-head">
            <h2 id={`${shelf.category}-heading`}>{videoCategoryLabel(shelf.category)}</h2>
            {shelf.total > shelf.videos.length ? (
              <a href={categoryPath(shelf.category)}>{`See all ${shelf.total}`}</a>
            ) : null}
          </div>
          <VideoGrid videos={shelf.videos} headingLevel="h3" />
        </section>
      ))}
    </div>
  )
}

async function CategoryView({ category, page }: { category: VideoCategory; page: number }) {
  const videos = await findVideos(category, page)
  if (videos.page !== page) redirect(withPageParam(categoryPath(category), videos.page))
  const label = videoCategoryLabel(category)
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Videos', path: '/videos' },
    { name: label, path: categoryPath(category) },
  ]
  return (
    <div className="page learn">
      <JsonLd data={{ '@graph': [{ '@type': 'CollectionPage', name: `${label} videos` }, breadcrumbList(crumbs)] }} />
      <header className="learn-head">
        <Breadcrumbs crumbs={crumbs} />
        <h1>{label}</h1>
      </header>
      {videos.items.length === 0 ? (
        <p className="empty-note">
          No videos in this category yet. <a href="/videos">See the whole library</a>.
        </p>
      ) : (
        <VideoGrid videos={videos.items} />
      )}
      <Pagination list={videos} href={categoryPath(category)} />
    </div>
  )
}
