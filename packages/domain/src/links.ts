import { err, ok, type Brand, type Result } from './primitives'

/** Where a CMS button may point: a path on this site, or a full https link. */
export type LinkHref = Brand<string, 'LinkHref'>

export type CtaLink = { label: string; href: LinkHref }

// Browsers read `//host` and `/\host` as links to another site, so a site path may not start with either.
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/
const HTTPS_URL = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:[/?#][^\s\\]*)?$/

export const parseLinkHref = (raw: string): Result<LinkHref, 'not_a_link'> =>
  raw.length <= 2048 && (SITE_PATH.test(raw) || HTTPS_URL.test(raw)) ? ok(raw as LinkHref) : err('not_a_link')
