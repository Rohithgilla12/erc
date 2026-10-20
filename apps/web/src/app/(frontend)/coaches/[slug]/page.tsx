import { parseListPage, withPageParam } from '@erc/domain'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import React from 'react'

import { findPosts, getCoach } from '@/content/learn'
import { clip, plainTextOf } from '@/content/plain-text'
import { RichText } from '@/content/rich-text'

import { Breadcrumbs, Pagination, PostList } from '../../learn/_components/lists'
import { coachPath, person } from '../../learn/_components/structured-data'
import { absoluteUrl, breadcrumbList, JsonLd } from '../../structured-data'

import '../../learn/_components/learn.css'

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string | string[] }> }

const coachOf = async (params: Props['params']) => {
  const coach = await getCoach((await params).slug)
  if (!coach) notFound()
  return coach
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const coach = await coachOf(params)
  const page = parseListPage((await searchParams).page)
  const description = clip(plainTextOf(coach.bio) || coach.credentials, 160)
  return {
    title: page === 1 ? coach.name : `${coach.name}, page ${page}`,
    description,
    alternates: { canonical: withPageParam(coachPath(coach), page) },
    openGraph: { type: 'profile', title: coach.name, description, url: coachPath(coach), ...(coach.photoUrl ? { images: [coach.photoUrl] } : {}) },
  }
}

export default async function CoachPage({ params, searchParams }: Props) {
  const coach = await coachOf(params)
  const page = parseListPage((await searchParams).page)
  const posts = await findPosts({ kind: 'author', id: coach.id }, page)
  if (posts.page !== page) redirect(withPageParam(coachPath(coach), posts.page))
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Learn', path: '/learn' },
    { name: coach.name, path: coachPath(coach) },
  ]

  return (
    <div className="page learn coach">
      <JsonLd data={{ '@graph': [{ '@type': 'ProfilePage', url: absoluteUrl(coachPath(coach)), mainEntity: person(coach) }, breadcrumbList(crumbs)] }} />
      <header className="coach-head">
        <Breadcrumbs crumbs={crumbs} />
        <div className="coach-identity">
          {coach.photoUrl ? (
            <Image unoptimized priority className="author-photo coach-photo" src={coach.photoUrl} alt="" width={96} height={96} />
          ) : (
            <span className="author-photo coach-photo author-initial" aria-hidden="true">
              {coach.name.charAt(0)}
            </span>
          )}
          <div>
            <h1>{coach.name}</h1>
            <p className="coach-credentials">{coach.credentials}</p>
          </div>
        </div>
      </header>
      {coach.bio ? <RichText value={coach.bio} className="prose article-body" /> : null}
      <section aria-labelledby="coach-posts-heading">
        <h2 id="coach-posts-heading" className="section-label">
          {`Articles by ${coach.name}`}
        </h2>
        {posts.items.length === 0 ? <p className="empty-note">No articles yet.</p> : <PostList posts={posts.items} headingLevel="h3" />}
        <Pagination list={posts} href={coachPath(coach)} />
      </section>
    </div>
  )
}
