import { describe, expect, it } from 'vitest'

import {
  contentPath,
  formatClockDuration,
  isoDuration,
  isReservedPostSlug,
  parseClockDuration,
  parseListPage,
  parseVideoCategory,
  readingMinutes,
  VIDEO_CATEGORIES,
  withPageParam,
  type Seconds,
  type Slug,
} from './index'

describe('parseClockDuration', () => {
  it.each([
    ['45', 45],
    ['0:45', 45],
    ['12:34', 754],
    ['1:02:03', 3723],
    [' 7:05 ', 425],
    ['90:00', 5400],
  ])('reads %j as %i seconds', (raw, seconds) => {
    expect(parseClockDuration(raw)).toEqual({ ok: true, value: seconds })
  })

  it.each(['', '0', '0:00', '1:60', '1:61:00', '12:3', 'abc', '1:2:3:4', '-5', '1.5'])('rejects %j', (raw) => {
    expect(parseClockDuration(raw)).toEqual({ ok: false, error: 'not_a_duration' })
  })
})

describe('formatClockDuration and isoDuration', () => {
  it.each([
    [45, '0:45', 'PT45S'],
    [754, '12:34', 'PT12M34S'],
    [3600, '1:00:00', 'PT1H'],
    [3723, '1:02:03', 'PT1H2M3S'],
  ])('%i seconds is %s and %s', (seconds, clock, iso) => {
    expect(formatClockDuration(seconds as Seconds)).toBe(clock)
    expect(isoDuration(seconds as Seconds)).toBe(iso)
  })

  it('round-trips through the parser', () => {
    for (const seconds of [1, 59, 60, 61, 3599, 3600, 36000]) {
      expect(parseClockDuration(formatClockDuration(seconds as Seconds))).toEqual({ ok: true, value: seconds })
    }
  })
})

describe('readingMinutes', () => {
  it.each([
    [0, 1],
    [50, 1],
    [299, 1],
    [300, 2],
    [1000, 5],
  ])('%i words take %i minute(s)', (words, minutes) => {
    expect(readingMinutes(words)).toBe(minutes)
  })
})

describe('parseListPage', () => {
  it.each([
    [undefined, 1],
    ['2', 2],
    [['3', '4'], 3],
    ['1000', 1000],
    ['1001', 1],
    ['0', 1],
    ['-2', 1],
    ['2.5', 1],
    ['', 1],
    ['abc', 1],
  ])('reads %j as page %i', (raw, page) => {
    expect(parseListPage(raw)).toBe(page)
  })
})

describe('withPageParam', () => {
  it('leaves page 1 off the URL', () => {
    expect(withPageParam('/learn/topic/beginner-running', 1)).toBe('/learn/topic/beginner-running')
  })

  it('adds page to a bare path or an existing query', () => {
    expect(withPageParam('/coaches/a', 3)).toBe('/coaches/a?page=3')
    expect(withPageParam('/videos?category=strength', 2)).toBe('/videos?category=strength&page=2')
  })
})

describe('contentPath', () => {
  it('routes each kind to its section', () => {
    const slug = 'zone-2' as Slug
    expect(contentPath({ kind: 'post', slug })).toBe('/learn/zone-2')
    expect(contentPath({ kind: 'video', slug })).toBe('/videos/zone-2')
    expect(contentPath({ kind: 'trainingPlan', slug })).toBe('/plans/zone-2')
    expect(contentPath({ kind: 'race', slug })).toBe('/races/zone-2')
  })
})

describe('video categories', () => {
  it('are the brief’s six, each parseable by its key', () => {
    expect(VIDEO_CATEGORIES).toHaveLength(6)
    for (const { key } of VIDEO_CATEGORIES) expect(parseVideoCategory(key)).toBe(key)
    expect(parseVideoCategory('cooking')).toBeNull()
  })
})

describe('isReservedPostSlug', () => {
  it('reserves the topic route segment only', () => {
    expect(isReservedPostSlug('topic')).toBe(true)
    expect(isReservedPostSlug('topics')).toBe(false)
  })
})
