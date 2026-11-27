/**
 * Proves the seeded Learn articles wait for staff: `pnpm payload run src/scripts/check-articles.ts` after
 * `seed-articles.ts`. Anonymous reads, the same ones the public site makes, return none of the posts or the topics the
 * seed created, while staff see every post in review with its full body. Writes nothing.
 */
import config from '@payload-config'
import type { EditorialState } from '@erc/domain'
import { getPayload } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { RichText } from '@/content/rich-text'
import { richTextOf } from '@/content/published'

import { ARTICLES } from './fixtures/articles'

const payload = await getPayload({ config })
const failures: string[] = []

const expect = (label: string, actual: unknown, wanted: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
  if (!ok) failures.push(label)
}

const staffDoc = (await payload.find({ collection: 'staff', where: { email: { equals: 'articles-seed@erc.invalid' } }, limit: 1 })).docs[0]
if (!staffDoc) throw new Error('Run src/scripts/seed-articles.ts first')
const staff = { user: { ...staffDoc, collection: 'staff' as const }, overrideAccess: false }

const anonymousSlugs = async (collection: 'posts' | 'topics', slugs: readonly string[], draft: boolean) =>
  (await payload.find({ collection, overrideAccess: false, draft, where: { slug: { in: slugs } }, pagination: false })).docs.map((doc) => doc.slug)

const slugs = ARTICLES.map((article) => article.slug)
expect('anonymous reads return no article', await anonymousSlugs('posts', slugs, false), [])
expect('anonymous draft reads return no article', await anonymousSlugs('posts', slugs, true), [])

const reviewTopics = (
  await payload.find({ collection: 'topics', draft: true, where: { slug: { in: ARTICLES.flatMap((a) => a.topics) } }, pagination: false, ...staff })
).docs.filter((topic) => (topic.workflow as EditorialState).live.kind === 'none')
expect(
  'anonymous reads return no topic still in review',
  await anonymousSlugs('topics', reviewTopics.map((topic) => topic.slug), false),
  [],
)

for (const article of ARTICLES) {
  const { docs } = await payload.find({ collection: 'posts', draft: true, depth: 0, where: { slug: { equals: article.slug } }, ...staff })
  const post = docs[0]
  const workflow = post?.workflow as EditorialState | undefined
  expect(`staff see ${article.slug}`, post?.title, article.title)
  expect(`${article.slug} is not live and is in review`, [workflow?.live.kind, workflow?.revision.kind], ['none', 'in_review'])
  expect(`${article.slug} main row is a draft`, post?._status, 'draft')
  expect(`${article.slug} has no author until staff choose one`, post?.authors ?? [], [])
  const html = post ? renderToStaticMarkup(createElement(RichText, { value: richTextOf(post.body) })) : ''
  expect(`${article.slug} renders headings and lists, with no Markdown left over`, [html.includes('<h2'), html.includes('<li'), html.includes('**')], [true, true, false])
}

console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed')
process.exit(failures.length ? 1 : 0)
