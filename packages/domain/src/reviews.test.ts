import { describe, expect, it } from 'vitest'

import { parseAnswerQuestion, parseAskQuestion, parseShoeCategory, parseWriteReview, subjectKeyOf, type Id, type LocalDate } from './index'

const today = '2026-11-27' as LocalDate
const shoeReview = { subjectKind: 'shoes', subjectId: '4', rating: '5', title: '  Soft   and light ', body: 'Good for easy days.' }

describe('parseWriteReview', () => {
  it('reads a new shoe review with its kilometres', () => {
    expect(parseWriteReview({ ...shoeReview, kmRun: '320' }, today)).toEqual({
      ok: true,
      value: { review: null, draft: { rating: 5, title: 'Soft and light', body: 'Good for easy days.', subject: { kind: 'shoes', id: 4 }, kmRun: 320 } },
    })
  })

  it('reads an edit of a race review with the year run, and ignores kilometres sent for a race', () => {
    const parsed = parseWriteReview({ subjectKind: 'races', subjectId: 9, review: '12', rating: 3, title: 'Hot', body: 'Start early.', yearRun: '2025', kmRun: '40' }, today)
    expect(parsed).toEqual({ ok: true, value: { review: 12, draft: { rating: 3, title: 'Hot', body: 'Start early.', subject: { kind: 'races', id: 9 }, yearRun: 2025 } } })
  })

  it('keeps paragraph breaks in the body but collapses runs of blank lines and spaces', () => {
    const parsed = parseWriteReview({ ...shoeReview, body: 'One.\r\n\r\n\r\n\r\nTwo   words.' }, today)
    expect(parsed.ok && parsed.value.draft.body).toBe('One.\n\nTwo words.')
  })

  it('refuses an unknown subject kind before anything else', () => {
    expect(parseWriteReview({ ...shoeReview, subjectKind: 'coaches' }, today)).toEqual({ ok: false, error: { subjectKind: 'Choose a shoe or a race to review.' } })
  })

  it('names every bad field at once', () => {
    const parsed = parseWriteReview({ subjectKind: 'races', subjectId: '0', rating: '6', title: '', body: 'x'.repeat(2001), yearRun: '2027' }, today)
    expect(parsed.ok ? [] : Object.keys(parsed.error).sort()).toEqual(['body', 'rating', 'subjectId', 'title', 'yearRun'])
  })

  it.each(['0', '1.5', ' ', 'five'])('refuses a rating of %j', (rating) => {
    expect(parseWriteReview({ ...shoeReview, rating }, today).ok).toBe(false)
  })

  it('refuses more kilometres than a shoe lasts', () => {
    expect(parseWriteReview({ ...shoeReview, kmRun: '5001' }, today)).toEqual({ ok: false, error: { kmRun: 'Enter whole kilometres from 0 to 5000.' } })
  })
})

describe('questions and answers', () => {
  it('reads a question about a race', () => {
    expect(parseAskQuestion({ race: '7', text: 'Is there a bag drop?' })).toEqual({ ok: true, value: { race: 7, text: 'Is there a bag drop?' } })
  })

  it('refuses an empty question and an over-long answer', () => {
    expect(parseAskQuestion({ race: '7', text: '   ' }).ok).toBe(false)
    expect(parseAnswerQuestion({ question: '3', answer: 'y'.repeat(2001) }).ok).toBe(false)
  })
})

describe('subjects and categories', () => {
  it('keys a subject by kind and id, so a shoe and a race with the same id never collide', () => {
    expect([subjectKeyOf({ kind: 'shoes', id: 3 as Id<'shoes'> }), subjectKeyOf({ kind: 'races', id: 3 as Id<'races'> })]).toEqual(['shoes:3', 'races:3'])
  })

  it('reads a known shoe category and nothing else', () => {
    expect([parseShoeCategory('trail'), parseShoeCategory(['racing']), parseShoeCategory('sandals'), parseShoeCategory(undefined)]).toEqual(['trail', 'racing', null, null])
  })
})
