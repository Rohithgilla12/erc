import { contentPath, isoDuration, type Coach, type CoachProfile, type Post, type Video } from '@erc/domain'
import React from 'react'

import { clip, plainTextOf } from '@/content/plain-text'
import { siteConfig } from '@/site-config'

import { CLUB } from '../../site-nav'

export const absoluteUrl = (path: string) => new URL(path, siteConfig().siteUrl).href

// JSON.stringify leaves `<` alone, so a title containing `</script>` could otherwise end the tag early.
const serialise = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serialise({ '@context': 'https://schema.org', ...data }) }} />
}

export type Crumb = { name: string; path: string }

export const breadcrumbList = (crumbs: readonly Crumb[]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: absoluteUrl(crumb.path) })),
})

const organisation = () => ({
  '@type': 'Organization',
  name: CLUB.name,
  url: absoluteUrl('/'),
  logo: { '@type': 'ImageObject', url: absoluteUrl('/brand/erc-logo-512.png'), width: 512, height: 512 },
})

const personRef = (coach: CoachProfile) => ({ '@type': 'Person', name: coach.name, url: absoluteUrl(`/coaches/${coach.slug}`) })

export const coachPath = (coach: Pick<CoachProfile, 'slug'>) => `/coaches/${coach.slug}`

export const article = (post: Post) => ({
  '@type': 'Article',
  headline: post.title,
  description: post.seo.description,
  url: absoluteUrl(contentPath(post)),
  mainEntityOfPage: absoluteUrl(contentPath(post)),
  datePublished: post.publishedAt,
  dateModified: post.updatedAt,
  ...(post.cover ? { image: [post.cover.url] } : {}),
  author: post.authors.length > 0 ? post.authors.map(personRef) : [organisation()],
  publisher: organisation(),
  articleSection: post.topics[0]?.title,
  ...(post.references.length > 0 ? { citation: post.references.map((reference) => reference.url) } : {}),
})

export const thumbnailPath = (video: Pick<Video, 'slug'>) => `/videos/${video.slug}/thumbnail.jpg`

export const videoObject = (video: Video) => {
  const transcript = plainTextOf(video.transcript)
  return {
    '@type': 'VideoObject',
    name: video.title,
    description: clip(video.seo.description, 500) || video.title,
    thumbnailUrl: [absoluteUrl(thumbnailPath(video))],
    uploadDate: video.publishedAt,
    duration: isoDuration(video.duration),
    embedUrl: `https://www.youtube-nocookie.com/embed/${video.youtubeId}`,
    url: absoluteUrl(contentPath(video)),
    publisher: organisation(),
    ...(transcript ? { transcript } : {}),
  }
}

export const person = (coach: Coach) => {
  const bio = plainTextOf(coach.bio)
  return {
    '@type': 'Person',
    name: coach.name,
    url: absoluteUrl(coachPath(coach)),
    description: clip(bio || coach.credentials, 300),
    ...(coach.photoUrl ? { image: coach.photoUrl } : {}),
    worksFor: organisation(),
  }
}
