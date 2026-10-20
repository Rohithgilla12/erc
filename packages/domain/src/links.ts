import { err, ok, type Brand, type Result } from './primitives'

/** A link target that is safe to render: a path on this site or a web link, never `javascript:` or `data:`. */
export type LinkHref = Brand<string, 'LinkHref'>

export type CtaLink = { label: string; href: LinkHref }

// Browsers read `//host` and `/\host` as links to another site, so a site path may not start with either.
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/
const HOST_AND_REST = String.raw`[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:[/?#][^\s\\]*)?`
const HTTPS_URL = new RegExp(`^https://${HOST_AND_REST}$`)
const HTTP_URL = new RegExp(`^http://${HOST_AND_REST}$`)
const MAILTO = /^mailto:[^\s@/\\:]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\?[^\s\\]*)?$/
const TEL = /^tel:\+?[\d().-]{3,24}$/

const MAX_HREF = 2048

/** Where a CMS button may point: a path on this site, or a full https link. */
export const parseLinkHref = (raw: string): Result<LinkHref, 'not_a_link'> =>
  raw.length <= MAX_HREF && (SITE_PATH.test(raw) || HTTPS_URL.test(raw)) ? ok(raw as LinkHref) : err('not_a_link')

/**
 * Where a link inside body text may point: anything a button may, and also plain http, `mailto:` and `tel:`, which
 * articles quote. Any other scheme, `javascript:` and `data:` included, is not a link.
 */
export const parseTextLinkHref = (raw: string): Result<LinkHref, 'not_a_link'> =>
  parseLinkHref(raw).ok || (raw.length <= MAX_HREF && [HTTP_URL, MAILTO, TEL].some((pattern) => pattern.test(raw)))
    ? ok(raw as LinkHref)
    : err('not_a_link')
