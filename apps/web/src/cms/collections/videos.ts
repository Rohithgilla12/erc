import { formatClockDuration, parseClockDuration, parseYouTubeId, VIDEO_CATEGORIES } from '@erc/domain'
import type { TextField } from 'payload'
import { text } from 'payload/shared'

import { publishedAtField, seoField, slugField, stampFirstPublished } from '../editorial-fields'
import { defineEditorial } from '../kinds'

/** Editors paste whatever YouTube gives them; only the 11-character id is stored. */
const youtubeIdField: TextField = {
  name: 'youtubeId',
  label: 'YouTube link or id',
  type: 'text',
  required: true,
  hooks: {
    beforeValidate: [
      ({ value }) => {
        const parsed = typeof value === 'string' ? parseYouTubeId(value) : null
        return parsed?.ok ? parsed.value : value
      },
    ],
  },
  validate: (value, args) => (value && !parseYouTubeId(value).ok ? 'Paste a YouTube link, such as https://youtu.be/…, or the video id' : text(value, args)),
  admin: { description: 'Paste the video link. Only the video id is kept; the video stays on YouTube.' },
}

const durationField: TextField = {
  name: 'duration',
  label: 'Length',
  type: 'text',
  required: true,
  hooks: {
    beforeValidate: [
      ({ value }) => {
        const parsed = typeof value === 'string' ? parseClockDuration(value) : null
        return parsed?.ok ? formatClockDuration(parsed.value) : value
      },
    ],
  },
  validate: (value, args) => (value && !parseClockDuration(value).ok ? 'Use minutes and seconds, such as 12:34, or 1:02:03' : text(value, args)),
  admin: { placeholder: '12:34', description: 'As YouTube shows it.' },
}

export const Videos = defineEditorial({
  slug: 'videos',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'category', 'duration', 'publishedAt'] },
  defaultSort: '-publishedAt',
  hooks: { beforeChange: [stampFirstPublished] },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title' }),
    youtubeIdField,
    durationField,
    {
      name: 'category',
      type: 'select',
      required: true,
      options: VIDEO_CATEGORIES.map(({ key, label }) => ({ value: key, label })),
      admin: { position: 'sidebar' },
    },
    { name: 'description', type: 'richText', required: true },
    {
      name: 'transcript',
      label: 'Transcript or captions',
      type: 'richText',
      admin: {
        description: 'Recommended. Runners who cannot play the video, and search engines, read the transcript on the page.',
      },
    },
    { name: 'topics', type: 'relationship', relationTo: 'topics', hasMany: true, admin: { position: 'sidebar' } },
    { name: 'relatedPosts', label: 'Related articles', type: 'relationship', relationTo: 'posts', hasMany: true, maxRows: 6 },
    publishedAtField,
    seoField,
  ],
})
