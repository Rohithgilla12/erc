import { contentKindOf, contentPath, parseSlug, parseTextLinkHref, type RichText as RichTextValue } from '@erc/domain'
import type { SerializedAutoLinkNode, SerializedLinkNode } from '@payloadcms/richtext-lexical'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText as LexicalRichText, type JSXConverter, type JSXConvertersFunction } from '@payloadcms/richtext-lexical/react'
import React from 'react'

type LinkNode = SerializedLinkNode | SerializedAutoLinkNode

/**
 * Where a link sends the reader, or null to show its text unlinked. Payload stores any URL that parses, `javascript:`
 * and `data:` included, so a custom link renders only if `parseTextLinkHref` accepts it. An internal link resolves only
 * while the reader may see its target; otherwise the target arrives unpopulated and has no public address.
 */
const hrefOf = ({ fields }: LinkNode): string | null => {
  if ('linkType' in fields && fields.linkType === 'internal') {
    const doc = fields.doc
    const kind = doc ? contentKindOf(doc.relationTo) : null
    const slug = doc && typeof doc.value === 'object' ? parseSlug(String((doc.value as { slug?: unknown }).slug ?? '')) : null
    return kind && slug?.ok ? contentPath({ kind, slug: slug.value }) : null
  }
  const href = parseTextLinkHref(fields.url ?? '')
  return href.ok ? href.value : null
}

const link: JSXConverter<LinkNode> = ({ node, nodesToJSX }) => {
  const children = nodesToJSX({ nodes: node.children })
  const href = hrefOf(node)
  if (href === null) return <>{children}</>
  return (
    <a href={href} {...(node.fields.newTab ? { rel: 'noopener noreferrer', target: '_blank' } : {})}>
      {children}
    </a>
  )
}

const converters: JSXConvertersFunction = ({ defaultConverters }) => ({ ...defaultConverters, link, autolink: link })

/**
 * The one renderer for CMS rich text. Public pages may not import Payload packages, so they render
 * the domain's opaque `RichText` through this component, and every page renders it the same way.
 */
export function RichText({ value, className }: { value: RichTextValue; className?: string }) {
  return <LexicalRichText className={className ?? 'prose'} converters={converters} data={value as unknown as SerializedEditorState} />
}
