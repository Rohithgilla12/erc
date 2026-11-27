/**
 * The Learn articles written for Indian club runners, read from `articles/*.md`. Each file has a small front matter
 * (title, slug, excerpt, topic slugs) and a body in the subset of Markdown the editor needs: `##` and `###` headings,
 * paragraphs, `-` lists, and `**bold**`. Anything else is refused, so a stray table or link cannot vanish silently.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RequiredDataFromCollectionSlug } from 'payload'

export type Body = RequiredDataFromCollectionSlug<'posts'>['body']

export type ArticleTopic = { slug: string; title: string; description: string; order: number }

/** Every topic an article may name. A topic that already exists is used as it is; a missing one is created for review. */
export const ARTICLE_TOPICS: readonly ArticleTopic[] = [
  {
    slug: 'beginner-running',
    title: 'Beginner running',
    description: 'Getting started, building up gently, and finishing your first races.',
    order: 1,
  },
  {
    slug: 'training-plans-and-pacing',
    title: 'Training plans and pacing',
    description: 'How a training week is put together, and how to judge your effort in training and on race day.',
    order: 2,
  },
  {
    slug: 'marathon-and-ultra-preparation',
    title: 'Marathon and ultra preparation',
    description: 'Long runs, tapering, fuelling, and race week for the half marathon and beyond.',
    order: 4,
  },
  {
    slug: 'nutrition-hydration-and-running-in-hot-weather',
    title: 'Nutrition, hydration and running in hot weather',
    description: 'Eating and drinking for training, and running safely in heat and humidity.',
    order: 6,
  },
  {
    slug: 'running-through-the-seasons',
    title: 'Running through the seasons',
    description: 'Training through Indian summers, monsoons, and winters, and adjusting for the weather on the day.',
    order: 8,
  },
  {
    slug: 'shoes-and-kit',
    title: 'Shoes and kit',
    description: 'Choosing, using, and replacing running shoes and kit, without the marketing.',
    order: 9,
  },
  {
    slug: 'coaching-at-erc',
    title: 'Coaching at ERC',
    description: 'How ERC coaches work with runners, and how the weekly check-in and review fit together.',
    order: 10,
  },
]

export type Article = { title: string; slug: string; excerpt: string; topics: readonly string[]; body: Body }

const block = { version: 1, direction: 'ltr' as const, format: '' as const, indent: 0 }
const BOLD = 1

/** Splits `**bold**` runs out of a line of text. */
const inline = (value: string) =>
  value
    .split(/\*\*(.+?)\*\*/)
    .map((text, index) => ({ type: 'text', version: 1, text, format: index % 2 === 1 ? BOLD : 0, style: '', mode: 'normal', detail: 0 }))
    .filter((node) => node.text !== '')

const paragraph = (value: string) => ({ ...block, type: 'paragraph', textFormat: 0, children: inline(value) })
const heading = (tag: 'h2' | 'h3', value: string) => ({ ...block, type: 'heading', tag, children: inline(value) })
const list = (items: readonly string[]) => ({
  ...block,
  type: 'list',
  listType: 'bullet',
  tag: 'ul',
  start: 1,
  children: items.map((item, index) => ({ ...block, type: 'listitem', value: index + 1, children: inline(item) })),
})

function parseBody(markdown: string, file: string): Body {
  const children: object[] = []
  for (const chunk of markdown.trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((line) => line.trim())
    const first = lines[0]!
    if (first.startsWith('### ')) children.push(heading('h3', first.slice(4)))
    else if (first.startsWith('## ')) children.push(heading('h2', first.slice(3)))
    else if (lines.every((line) => line.startsWith('- '))) children.push(list(lines.map((line) => line.slice(2))))
    else if (lines.some((line) => /^(#|- |\d+\. |\||>|```)/.test(line)) || /\[[^\]]*\]\(/.test(chunk)) {
      throw new Error(`${file}: unsupported Markdown in "${first}"`)
    } else children.push(paragraph(lines.join(' ')))
  }
  return { root: { ...block, type: 'root', children } } as Body
}

const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1')

function parseArticle(text: string, file: string): Article {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!match) throw new Error(`${file}: missing front matter`)
  const meta = new Map(
    match[1]!.split('\n').map((line) => {
      const colon = line.indexOf(':')
      return [line.slice(0, colon).trim(), unquote(line.slice(colon + 1).trim())] as const
    }),
  )
  const field = (name: string) => {
    const value = meta.get(name)
    if (!value) throw new Error(`${file}: front matter needs ${name}`)
    return value
  }
  const excerpt = field('excerpt')
  if (excerpt.length > 300) throw new Error(`${file}: the excerpt is ${excerpt.length} characters; posts allow 300`)
  const topics = field('topics').split(',').map((slug) => slug.trim())
  for (const slug of topics) {
    if (!ARTICLE_TOPICS.some((topic) => topic.slug === slug)) throw new Error(`${file}: unknown topic ${slug}`)
  }
  return { title: field('title'), slug: field('slug'), excerpt, topics, body: parseBody(match[2]!, file) }
}

const directory = join(import.meta.dirname, 'articles')

export const ARTICLES: readonly Article[] = readdirSync(directory)
  .filter((name) => name.endsWith('.md'))
  .sort()
  .map((name) => parseArticle(readFileSync(join(directory, name), 'utf8'), name))
