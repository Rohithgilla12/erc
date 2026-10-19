import type { RichText } from '@erc/domain'

type LexicalNode = { type?: unknown; text?: unknown; children?: unknown }

const BLOCKS = new Set(['paragraph', 'heading', 'quote', 'listitem', 'list', 'linebreak'])

/** The words of a rich-text value, for reading time, meta descriptions, and structured data. */
export function plainTextOf(value: RichText | null): string {
  const root = (value as { root?: LexicalNode } | null)?.root
  if (!root) return ''
  const parts: string[] = []
  const walk = (node: LexicalNode) => {
    if (typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.children)) node.children.forEach((child) => walk(child as LexicalNode))
    if (typeof node.type === 'string' && BLOCKS.has(node.type)) parts.push('\n')
  }
  walk(root)
  return parts
    .join('')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** Cuts at a word boundary and marks the cut, for meta descriptions. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trimEnd()}…`
}
