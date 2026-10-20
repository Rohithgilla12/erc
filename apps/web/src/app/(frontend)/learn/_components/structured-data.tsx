import { contentPath, isoDuration, type Coach, type CoachProfile, type Post, type Video } from '@erc/domain'

import { clip, plainTextOf } from '@/content/plain-text'
import { absoluteUrl } from '@/site-config'

import { organisationRef } from '../../structured-data'

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
  author: post.authors.length > 0 ? post.authors.map(personRef) : [organisationRef()],
  publisher: organisationRef(),
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
    publisher: organisationRef(),
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
    worksFor: organisationRef(),
  }
}
