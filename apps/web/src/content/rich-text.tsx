import type { RichText as RichTextValue } from '@erc/domain'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { RichText as LexicalRichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'

/**
 * The one renderer for CMS rich text. Public pages may not import Payload packages, so they render
 * the domain's opaque `RichText` through this component, and every page renders it the same way.
 */
export function RichText({ value, className }: { value: RichTextValue; className?: string }) {
  return <LexicalRichText className={className ?? 'prose'} data={value as unknown as SerializedEditorState} />
}
