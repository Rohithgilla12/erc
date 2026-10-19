/**
 * Seeds the learning centre for local work: `pnpm payload run src/scripts/seed-learn.ts`. Creates the brief's seven
 * topics, two placeholder coaches, four placeholder posts, and three placeholder videos, all published. Every document
 * is matched by slug, so a re-run updates the same rows instead of adding new ones. The video ids are made up and
 * labelled as placeholders; they play nothing.
 */
import config from '@payload-config'
import { getPayload, type CollectionSlug, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed placeholder content in production')

const payload = await getPayload({ config })

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({ collection: 'staff', where: { email: { equals: seedEmail } }, limit: 1 })
const staff =
  existingStaff.docs[0] ??
  (await payload.create({ collection: 'staff', data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' } }))
// Payload's auth strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staff, collection: 'staff' as const }
const context = { skipRevalidation: true }

const text = (value: string) => ({ type: 'text', version: 1, text: value, format: 0, style: '', mode: 'normal', detail: 0 })
const block = { version: 1, direction: 'ltr' as const, format: '' as const, indent: 0 }
const paragraph = (value: string) => ({ ...block, type: 'paragraph', textFormat: 0, children: [text(value)] })
const heading = (value: string) => ({ ...block, type: 'heading', tag: 'h2', children: [text(value)] })
const richText = (...children: object[]) => ({ root: { ...block, type: 'root', children } }) as RequiredDataFromCollectionSlug<'posts'>['body']

type Seeded = 'topics' | 'coaches' | 'posts' | 'videos'

/** Creates the document, or publishes the given fields over the one with the same slug. */
async function upsert<S extends Seeded & CollectionSlug>(
  collection: S,
  data: RequiredDataFromCollectionSlug<S> & { slug: string },
): Promise<{ id: number }> {
  const { docs } = await payload.find({ collection, where: { slug: { equals: data.slug } }, draft: true, depth: 0, limit: 1, pagination: false })
  const existing = docs[0]
  const write = { data: { ...data, _status: 'published' as const }, user, overrideAccess: false, context }
  // The generic collection slug defeats Payload's overloads; by-id update and create both return the one document.
  const doc = existing ? await payload.update({ collection, id: existing.id, ...write } as never) : await payload.create({ collection, ...write } as never)
  return doc as { id: number }
}

const TOPICS = [
  ['Beginner running', 'beginner-running'],
  ['Training plans and pacing', 'training-plans-and-pacing'],
  ['Heart rate, Zone 2 and MAF', 'heart-rate-zone-2-and-maf'],
  ['Marathon and ultra preparation', 'marathon-and-ultra-preparation'],
  ['Strength, mobility and recovery', 'strength-mobility-and-recovery'],
  ['Nutrition, hydration and running in hot weather', 'nutrition-hydration-and-running-in-hot-weather'],
  ['Race reports and athlete stories', 'race-reports-and-athlete-stories'],
] as const

const topicIds = new Map<string, number>()
for (const [index, [title, slug]] of TOPICS.entries()) {
  const topic = await upsert('topics', {
    title,
    slug,
    order: index + 1,
    description: `Placeholder: a coach will describe what the ${title.toLowerCase()} articles cover.`,
  })
  topicIds.set(slug, topic.id)
}
const topic = (slug: (typeof TOPICS)[number][1]) => topicIds.get(slug)!

const coachIds = new Map<string, number>()
for (const letter of ['A', 'B']) {
  const coach = await upsert('coaches', {
    name: `Placeholder Coach ${letter}`,
    slug: `placeholder-coach-${letter.toLowerCase()}`,
    credentials: 'Placeholder: credentials will be written by the coach.',
    bio: richText(paragraph(`Placeholder: Coach ${letter} will write a short biography here.`)),
  })
  coachIds.set(letter, coach.id)
}
const coach = (letter: 'A' | 'B') => coachIds.get(letter)!

const placeholderBody = (subject: string) =>
  richText(
    paragraph(`Placeholder: this article about ${subject} has not been written yet. A coach will replace this text before launch.`),
    heading('Placeholder section'),
    paragraph('Placeholder: the finished article will explain the idea in plain language, with an example session where it helps.'),
    paragraph('Placeholder: any claim that rests on research will cite its source in the references below the article.'),
  )

const POSTS = [
  {
    title: 'Placeholder: your first weeks of running',
    slug: 'placeholder-your-first-weeks-of-running',
    excerpt: 'Placeholder: how a new runner might structure their first few weeks.',
    topics: [topic('beginner-running')],
    authors: [coach('A')],
  },
  {
    title: 'Placeholder: reading an easy pace',
    slug: 'placeholder-reading-an-easy-pace',
    excerpt: 'Placeholder: what "easy" means in a training plan, and how to tell.',
    topics: [topic('training-plans-and-pacing'), topic('heart-rate-zone-2-and-maf')],
    authors: [coach('B')],
  },
  {
    title: 'Placeholder: planning a first ultra',
    slug: 'placeholder-planning-a-first-ultra',
    excerpt: 'Placeholder: the questions to answer before entering a first ultramarathon.',
    topics: [topic('marathon-and-ultra-preparation')],
    authors: [coach('A'), coach('B')],
    references: [
      { title: 'Placeholder reference one', url: 'https://example.org/placeholder-reference-one', publisher: 'Placeholder publisher' },
      { title: 'Placeholder reference two', url: 'https://example.org/placeholder-reference-two' },
    ],
  },
  {
    title: 'Placeholder: a race report outline',
    slug: 'placeholder-a-race-report-outline',
    excerpt: 'Placeholder: an outline athletes can follow when they write up a race.',
    topics: [topic('race-reports-and-athlete-stories')],
    authors: [coach('B')],
  },
]

const bodyOf = (post: (typeof POSTS)[number]) => placeholderBody(post.title.replace('Placeholder: ', ''))

const postIds = new Map<string, number>()
for (const post of POSTS) {
  const doc = await upsert('posts', { ...post, body: bodyOf(post) })
  postIds.set(post.slug, doc.id)
}
const postId = (slug: string) => postIds.get(slug)!

const VIDEOS = [
  {
    title: 'Placeholder video: running form drills',
    slug: 'placeholder-video-running-form-drills',
    youtubeId: 'placehold-a',
    duration: '4:12',
    category: 'technique',
    topics: [topic('beginner-running')],
    relatedPosts: [postId('placeholder-your-first-weeks-of-running')],
    transcript: richText(paragraph('Placeholder: the transcript of this video will appear here.')),
  },
  {
    title: 'Placeholder video: strength circuit walkthrough',
    slug: 'placeholder-video-strength-circuit-walkthrough',
    youtubeId: 'placehold-b',
    duration: '11:05',
    category: 'strength',
    topics: [topic('strength-mobility-and-recovery')],
    relatedPosts: [],
  },
  {
    title: 'Placeholder video: race-day checklist',
    slug: 'placeholder-video-race-day-checklist',
    youtubeId: 'placehold-c',
    duration: '7:40',
    category: 'race-preparation',
    topics: [topic('marathon-and-ultra-preparation')],
    relatedPosts: [postId('placeholder-planning-a-first-ultra')],
  },
] as const

const videoIds = new Map<string, number>()
for (const video of VIDEOS) {
  const doc = await upsert('videos', {
    ...video,
    topics: [...video.topics],
    relatedPosts: [...video.relatedPosts],
    description: richText(paragraph(`Placeholder: a short description of "${video.title}" will go here. The video id is made up.`)),
  })
  videoIds.set(video.slug, doc.id)
}

await upsert('posts', {
  ...POSTS[0]!,
  body: bodyOf(POSTS[0]!),
  related: [
    { relationTo: 'posts', value: postId('placeholder-reading-an-easy-pace') },
    { relationTo: 'videos', value: videoIds.get('placeholder-video-running-form-drills')! },
  ],
})
await upsert('posts', {
  ...POSTS[2]!,
  body: bodyOf(POSTS[2]!),
  related: [{ relationTo: 'videos', value: videoIds.get('placeholder-video-race-day-checklist')! }],
})

console.log(`Seeded ${TOPICS.length} topics, ${coachIds.size} coaches, ${postIds.size} posts, and ${videoIds.size} videos`)
await refreshRunningSite(payload, (['topics', 'coaches', 'posts', 'videos'] as const).map(collectionTag))
process.exit(0)
