import { describe, expect, it } from 'vitest'
import { parseLocalDate, parseYouTubeId, todayIn } from './index'

describe('parseLocalDate', () => {
  it.each(['2026-10-19', '2028-02-29', '2026-12-31', '2026-01-01', '0001-01-01'])('accepts the real date %s unchanged', (raw) => {
    expect(parseLocalDate(raw)).toEqual({ ok: true, value: raw })
  })

  it.each([
    '2026-02-30',
    '2026-02-29',
    '2100-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-1-19',
    '26-10-19',
    ' 2026-10-19',
    '2026-10-19T00:00:00Z',
    '2026/10/19',
    '',
  ])('rejects %j', (raw) => {
    expect(parseLocalDate(raw)).toEqual({ ok: false, error: 'not_a_date' })
  })
})

describe('todayIn Asia/Kolkata', () => {
  it('is still the UTC date one second before IST midnight', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-10-19T18:29:59Z'))).toBe('2026-10-19')
  })

  it('rolls to the next date at IST midnight, 18:30 UTC', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20')
  })

  it('crosses the year boundary in IST before UTC does', () => {
    expect(todayIn('Asia/Kolkata', new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01')
  })
})

describe('parseYouTubeId', () => {
  const id = 'dQw4w9WgXcQ'

  it.each([
    id,
    `  ${id}  `,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${id}&list=PL123`,
    `https://www.youtube.com/watch?v=${id}#comments`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?si=abc123&t=10`,
    `https://www.youtube.com/embed/${id}?autoplay=1`,
    `https://www.youtube.com/shorts/${id}`,
    `https://youtube.com/shorts/${id}?feature=share`,
    `youtube.com/watch?v=${id}`,
  ])('extracts the id from %s', (input) => {
    expect(parseYouTubeId(input)).toEqual({ ok: true, value: id })
  })

  it.each([
    'dQw4w9WgXc',
    'dQw4w9WgXcQQ',
    'dQw4w9WgXc!',
    `https://www.youtube.com/watch?v=${id}Q`,
    `https://www.youtube.com/watch?xv=${id}`,
    `https://www.youtube.com/watch?list=PL123`,
    `https://www.youtube.com/channel/${id}`,
    `https://vimeo.com/${id}`,
    `https://youtu.be.evil.com/${id}`,
    `https://evilyoutube.com/watch?v=${id}`,
    `https://youtube.com.evil.com/watch?v=${id}`,
    `ftp://youtu.be/${id}`,
    '',
  ])('rejects %s', (input) => {
    expect(parseYouTubeId(input)).toEqual({ ok: false, error: 'not_youtube' })
  })
})
