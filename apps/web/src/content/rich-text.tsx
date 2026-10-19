import { contentPath, parseSlug, type ContentRef, type RichText as RichTextValue } from '@erc/domain'
import type { SerializedLinkNode } from '@payloadcms/richtext-lexical'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { LinkJSXConverter, RichText as LexicalRichText, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import React from 'react'

const KIND_OF: Partial<Record<string, ContentRef['kind']>> = { posts: 'post', videos: 'video', trainingPlans: 'trainingPlan', races: 'race' }

/**
 * Payload renders an internal link as `#` unless told the target's address. A target the reader may not see comes
 * back unpopulated, so it has no public address and stays `#`.
 */
const internalDocToHref = ({ linkNode }: { linkNode: SerializedLinkNode }) => {
  const doc = linkNode.fields.doc
  const kind = doc ? KIND_OF[doc.relationTo] : undefined
  const slug = doc && typeof doc.value === 'object' ? parseSlug(String((doc.value as { slug?: unknown }).slug ?? '')) : null
  return kind && slug?.ok ? contentPath({ kind, slug: slug.value }) : '#'
}

const converters: JSXConvertersFunction = ({ defaultConverters }) => ({ ...defaultConverters, ...LinkJSXConverter({ internalDocToHref }) })

/**
 * The one renderer for CMS rich text. Public pages may not import Payload packages, so they render
 * the domain's opaque `RichText` through this component, and every page renders it the same way.
 */
export function RichText({ value, className }: { value: RichTextValue; className?: string }) {
  return <LexicalRichText className={className ?? 'prose'} converters={converters} data={value as unknown as SerializedEditorState} />
}
