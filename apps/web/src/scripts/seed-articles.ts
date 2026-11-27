/**
 * Puts the six Learn articles in `fixtures/articles/` into the CMS for staff to read and publish:
 * `pnpm payload run src/scripts/seed-articles.ts`. Each post is matched by slug and left as a revision in review,
 * never published, with no author: whoever publishes it chooses whose name goes on it. A missing topic is created the
 * same way; an existing topic is used untouched. A post staff have published is left alone, and a post whose draft
 * already matches its file is not saved again, so a re-run changes nothing. Until a post is published its file is the
 * source: a re-run replaces any edits staff made to the draft in /admin.
 *
 * It saves as an `author`, a role that can submit for review but cannot publish, so no run can put an article live.
 */
import { isDeepStrictEqual } from 'node:util'

import config from '@payload-config'
import type { EditorialState } from '@erc/domain'
import { getPayload } from 'payload'

import { ARTICLE_TOPICS, ARTICLES, type Article } from './fixtures/articles'

import { seedStaffAccount } from './staff-account'

const payload = await getPayload({ config })

const user = await seedStaffAccount(payload, 'articles-seed@erc.invalid', 'author')
// Nothing here is public, so no cached page can change.
const asAuthor = { user, overrideAccess: false, context: { skipRevalidation: true } }
const submitted = { reviewRequest: 'submit' as const }

const latestDraft = async <S extends 'topics' | 'posts'>(collection: S, slug: string) =>
  (await payload.find({ collection, where: { slug: { equals: slug } }, draft: true, depth: 0, limit: 1, pagination: false, ...asAuthor })).docs[0]

const topicIds = new Map<string, number>()
for (const topic of ARTICLE_TOPICS) {
  const existing = await latestDraft('topics', topic.slug)
  const id = existing?.id ?? (await payload.create({ collection: 'topics', data: { ...topic, ...submitted }, draft: true, ...asAuthor })).id
  topicIds.set(topic.slug, id)
  console.log(`topic ${topic.slug}: ${existing ? 'exists, left as it is' : 'created, in review'}`)
}

const dataOf = (article: Article) => ({
  title: article.title,
  slug: article.slug,
  excerpt: article.excerpt,
  topics: article.topics.map((slug) => topicIds.get(slug)!),
  body: article.body,
})

type PostFields = ReturnType<typeof dataOf>

// Postgres `jsonb` reorders object keys, so the stored body is compared by value, not by its serialised text.
const sameFields = ({ title, slug, excerpt, topics, body }: PostFields, wanted: PostFields) =>
  isDeepStrictEqual({ title, slug, excerpt, topics, body }, wanted)

for (const article of ARTICLES) {
  const wanted = dataOf(article)
  const existing = await latestDraft('posts', article.slug)
  const state = existing?.workflow as EditorialState | undefined
  let outcome: string
  if (!existing) {
    await payload.create({ collection: 'posts', data: { ...wanted, ...submitted }, draft: true, ...asAuthor })
    outcome = 'created, in review'
  } else if (state!.live.kind === 'published') {
    outcome = 'published by staff, left alone'
  } else if (state!.revision.kind === 'in_review' && sameFields(existing as PostFields, wanted)) {
    outcome = 'unchanged, in review'
  } else {
    await payload.update({ collection: 'posts', id: existing.id, data: { ...wanted, ...submitted }, draft: true, ...asAuthor })
    outcome = 'updated, in review'
  }
  console.log(`post ${article.slug}: ${outcome}`)
}

process.exit(0)
