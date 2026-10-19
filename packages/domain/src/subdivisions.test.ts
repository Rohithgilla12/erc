import { describe, expect, it } from 'vitest'
import { INDIAN_SUBDIVISIONS, parseSubdivision, subdivisionBySlug, subdivisionOf } from './index'

describe('INDIAN_SUBDIVISIONS', () => {
  it('has unique codes and unique lowercase hyphenated slugs', () => {
    const codes = INDIAN_SUBDIVISIONS.map((s) => s.code)
    const slugs = INDIAN_SUBDIVISIONS.map((s) => s.slug)
    expect(new Set(codes).size).toBe(codes.length)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs.filter((slug) => !/^[a-z]+(-[a-z]+)*$/.test(slug))).toEqual([])
  })

  it.each(['IN-TG', 'IN-CT', 'IN-OR', 'IN-UT'])('has no pre-2023 code %s', (code) => {
    expect(INDIAN_SUBDIVISIONS.map((s) => s.code)).not.toContain(code)
  })
})

describe('parseSubdivision', () => {
  it.each([
    ['IN-TS', 'IN-TS'],
    ['in-ts', 'IN-TS'],
    [' IN-AP ', 'IN-AP'],
    ['IN-TG', null],
    ['US-CA', null],
    ['Telangana', null],
    ['', null],
  ] as const)('parses %j as %j', (raw, code) => {
    expect(parseSubdivision(raw)).toBe(code)
  })
})

describe('subdivision slugs', () => {
  it('map to and from codes', () => {
    expect(subdivisionBySlug('telangana')?.code).toBe('IN-TS')
    expect(subdivisionOf('IN-AP').slug).toBe('andhra-pradesh')
  })

  it('are exact, so a differently cased slug finds nothing', () => {
    expect(subdivisionBySlug('Telangana')).toBeNull()
  })
})
