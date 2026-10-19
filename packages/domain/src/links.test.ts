import { describe, expect, it } from 'vitest'
import { parseLinkHref } from './index'

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
