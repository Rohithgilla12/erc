import { describe, expect, it } from 'vitest'
import { parseLinkHref, parseTextLinkHref } from './index'

describe('parseLinkHref', () => {
  it('accepts paths on this site and https links', () => {
    for (const href of ['/', '/races', '/contact?topic=coaching#enquiry', 'https://www.instagram.com/endurancerunclubindia/']) {
      expect(parseLinkHref(href)).toEqual({ ok: true, value: href })
    }
  })

  it('refuses anything a browser would send to another scheme or another site', () => {
    for (const href of ['//evil.example', '/\\evil.example', 'http://example.com', 'javascript:alert(1)', 'races', '', '/ races', 'https://']) {
      expect(parseLinkHref(href).ok).toBe(false)
    }
  })
})

describe('parseTextLinkHref', () => {
  it('accepts what a button accepts, plus http, mailto and tel', () => {
    for (const href of ['/races', 'https://example.org/a?b#c', 'http://example.org/old', 'mailto:coach@example.org', 'mailto:coach@example.org?subject=Hi', 'tel:+919876543210']) {
      expect(parseTextLinkHref(href)).toEqual({ ok: true, value: href })
    }
  })

  it('refuses script, data and every other scheme, and links that leave the site by trickery', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:javascript:alert(1)',
      'tel:javascript:alert(1)',
      '//evil.example',
      'http:/evil.example',
      '',
    ]) {
      expect(parseTextLinkHref(href).ok).toBe(false)
    }
  })
})
