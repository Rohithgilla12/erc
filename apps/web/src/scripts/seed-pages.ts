/**
 * Publishes placeholder Home, About, Coaching and Contact pages for local work: `pnpm payload run src/scripts/seed-pages.ts`.
 * Re-running overwrites those four pages by slug and leaves every other page alone. Coach cards list whichever coaches
 * are already published; the script never creates people.
 */
import config from '@payload-config'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { CLUB } from '@/app/(frontend)/site-nav'
import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

type PageData = RequiredDataFromCollectionSlug<'pages'>
type Layout = PageData['layout']

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed placeholder pages in production')

const paragraph = (text: string) => ({
  type: 'paragraph',
  version: 1,
  direction: 'ltr' as const,
  format: '' as const,
  indent: 0,
  textFormat: 0,
  children: [{ type: 'text', version: 1, text, detail: 0, format: 0, mode: 'normal', style: '' }],
})

const richText = (...paragraphs: string[]) => ({
  root: { type: 'root', version: 1, direction: 'ltr' as const, format: '' as const, indent: 0, children: paragraphs.map(paragraph) },
})

const COACHING_ENQUIRY = '/contact?topic=coaching#enquiry'

const pages = (coaches: number[]): PageData[] => {
  const coachGrid: Layout = coaches.length > 0 ? [{ blockType: 'coachGrid', heading: 'Our coaches', coaches }] : []
  return [
    {
      slug: 'home',
      title: 'Home',
      layout: [
        {
          blockType: 'hero',
          heading: CLUB.tagline,
          body: CLUB.description,
          primary: { label: 'See upcoming races', href: '/races' },
          secondary: { label: 'Coaching', href: '/coaching' },
        },
        { blockType: 'featuredRaces', heading: 'Upcoming races', count: 3 },
        { blockType: 'latestPosts', heading: 'Latest articles', count: 3 },
        { blockType: 'featuredPlans', heading: 'Training plans', count: 3 },
        {
          blockType: 'richText',
          body: richText('Placeholder: a short introduction to the club, its runs and its runners goes here.'),
        },
        {
          blockType: 'callToAction',
          heading: 'Train with a coach',
          body: 'Placeholder: one or two sentences on what coaching with the club involves.',
          link: { label: 'Ask about coaching', href: COACHING_ENQUIRY },
        },
      ],
    },
    {
      slug: 'about',
      title: 'About',
      layout: [
        {
          blockType: 'hero',
          heading: `About ${CLUB.name}`,
          body: CLUB.description,
          primary: { label: 'See upcoming races', href: '/races' },
          secondary: { label: 'Contact us', href: '/contact' },
        },
        {
          blockType: 'richText',
          body: richText(
            'Placeholder: the story of the club, where and when it runs, and who it is for.',
            'Placeholder: a second paragraph on the club’s values and how new runners can join in.',
          ),
        },
        ...coachGrid,
      ],
    },
    {
      slug: 'coaching',
      title: 'Coaching',
      layout: [
        {
          blockType: 'hero',
          heading: 'Coaching',
          body: 'Placeholder: who the coaching is for, from first 5K to first ultra.',
          primary: { label: 'Ask about coaching', href: COACHING_ENQUIRY },
          secondary: { label: 'See upcoming races', href: '/races' },
        },
        {
          blockType: 'richText',
          body: richText('Placeholder: how coaching works, what a training week looks like, and how progress is reviewed.'),
        },
        ...coachGrid,
        {
          blockType: 'faq',
          heading: 'Questions about coaching',
          items: [
            { question: 'Do I need to be fast to join?', answer: richText('Placeholder: the club’s answer goes here.') },
            { question: 'How do sessions work?', answer: richText('Placeholder: the club’s answer goes here.') },
            { question: 'What does coaching cost?', answer: richText('Placeholder: the club’s answer goes here.') },
          ],
        },
      ],
    },
    {
      slug: 'contact',
      title: 'Contact',
      layout: [
        {
          blockType: 'hero',
          heading: 'Contact us',
          body: 'Placeholder: what to write to the club about, and when to expect a reply.',
        },
        {
          blockType: 'faq',
          heading: 'Before you write',
          items: [
            { question: 'Can I list a race on the calendar?', answer: richText('Placeholder: the club’s answer goes here.') },
            { question: 'Do you work with sponsors?', answer: richText('Placeholder: the club’s answer goes here.') },
          ],
        },
      ],
    },
  ]
}

const payload = await getPayload({ config })

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({ collection: 'staff', where: { email: { equals: seedEmail } }, limit: 1 })
const staff =
  existingStaff.docs[0] ??
  (await payload.create({ collection: 'staff', data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' } }))

// Publishing is a workflow transition stamped from the acting user, so the seed acts as its editor. Payload's auth
// strategy tags the user with its collection; a Local API caller must do the same.
const user = { ...staff, collection: 'staff' as const }
const context = { skipRevalidation: true }

const publishedCoaches = await payload.find({ collection: 'coaches', overrideAccess: false, depth: 0, limit: 6, sort: 'name', pagination: false })

for (const data of pages(publishedCoaches.docs.map((coach) => coach.id))) {
  const { docs } = await payload.find({ collection: 'pages', where: { slug: { equals: data.slug } }, depth: 0, limit: 1, pagination: false })
  const existing = docs[0]
  if (existing) {
    await payload.update({ collection: 'pages', id: existing.id, data: { ...data, _status: 'published' }, user, context })
  } else {
    await payload.create({ collection: 'pages', data: { ...data, _status: 'published' }, user, context })
  }
  console.log(`${existing ? 'Updated' : 'Created'} and published /${data.slug === 'home' ? '' : data.slug}`)
}

await refreshRunningSite(payload, [collectionTag('pages')])
process.exit(0)
