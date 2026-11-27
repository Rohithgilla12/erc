import { describe, expect, it } from 'vitest'

import { INTAKE_QUESTIONS, intakeAnswerText, intakeFieldValue, parseIntakeAnswers, parseIntakeSubmission, type IntakeKey } from './intake'
import type { LocalDate } from './primitives'

const today = '2026-11-27' as LocalDate

const complete = {
  birthYear: '1990',
  goal: 'faster',
  weeklyKm: '25.5',
  sleepHours: '7',
  sleepQuality: 'fair',
  nutrition: 'regular',
  healthCondition: 'none',
}

describe('parseIntakeAnswers', () => {
  it('accepts the required answers and leaves every optional one null', () => {
    const parsed = parseIntakeAnswers(complete, today)
    expect(parsed).toEqual({
      ok: true,
      value: {
        birthYear: 1990,
        goal: 'faster',
        goalDetail: null,
        weeklyKm: 25.5,
        recent5k: null,
        recent10k: null,
        eventsLastYear: null,
        sleepHours: 7,
        sleepQuality: 'fair',
        nutrition: 'regular',
        nutritionNotes: null,
        healthCondition: 'none',
        healthNotes: null,
        injuries: null,
        medications: null,
      },
    })
  })

  it('refuses a key that names no question, alongside the other errors', () => {
    const parsed = parseIntakeAnswers({ ...complete, bloodType: 'O+', goal: '' }, today)
    expect(parsed).toEqual({ ok: false, error: { bloodType: 'This is not an intake question.', goal: 'Answer this question.' } })
  })

  it('names each missing required question', () => {
    const { sleepQuality: _sleep, healthCondition: _health, ...rest } = complete
    const parsed = parseIntakeAnswers(rest, today)
    expect(parsed.ok ? [] : Object.keys(parsed.error).sort()).toEqual(['healthCondition', 'sleepQuality'])
  })

  it.each(['28:4', '28:60', 'abc', '28.45', '1:75:00', ':30', '28:45:00:00'])('refuses the malformed time %s', (time) => {
    const parsed = parseIntakeAnswers({ ...complete, recent5k: time }, today)
    expect(parsed.ok ? null : parsed.error.recent5k).toMatch(/^Enter the time as minutes:seconds/)
  })

  it('reads a 10K slower than an hour written either way', () => {
    for (const time of ['62:10', '1:02:10']) {
      const parsed = parseIntakeAnswers({ ...complete, recent10k: time }, today)
      expect(parsed.ok && parsed.value.recent10k).toBe(3730)
    }
  })

  it('refuses a well-formed time outside the plausible range for the distance', () => {
    const parsed = parseIntakeAnswers({ ...complete, recent5k: '8:00' }, today)
    expect(parsed.ok ? null : parsed.error.recent5k).toBe('Enter a time from 12:00 to 2:00:00.')
  })

  it('refuses a choice outside its options', () => {
    const parsed = parseIntakeAnswers({ ...complete, healthCondition: 'asthma' }, today)
    expect(parsed.ok ? null : parsed.error.healthCondition).toBe('Choose one of the options.')
  })

  it('refuses a birth year under the member age, and a fractional year', () => {
    for (const birthYear of ['2010', '1990.5']) {
      const parsed = parseIntakeAnswers({ ...complete, birthYear }, today)
      expect(parsed.ok ? null : parsed.error.birthYear).toBe('Enter a whole number from 1920 to 2008.')
    }
  })

  it('refuses text over its limit', () => {
    const parsed = parseIntakeAnswers({ ...complete, medications: 'x'.repeat(501) }, today)
    expect(parsed.ok ? null : parsed.error.medications).toBe('Keep this under 500 characters.')
  })

  it('refuses anything that is not an answers object', () => {
    for (const raw of [null, 'answers', [complete]]) expect(parseIntakeAnswers(raw, today)).toEqual({ ok: false, error: { answers: 'Send the answers as an object.' } })
  })

  it('parses its own output to the same answers, as a stored row is read back', () => {
    const first = parseIntakeAnswers({ ...complete, recent5k: '27:05', recent10k: '1:01:00', injuries: 'Left calf' }, today)
    if (!first.ok) throw new Error('fixture should parse')
    expect(parseIntakeAnswers(JSON.parse(JSON.stringify(first.value)), today)).toEqual(first)
  })
})

describe('parseIntakeSubmission', () => {
  it('refuses a save without consent, with the answer errors too', () => {
    const parsed = parseIntakeSubmission({ answers: { ...complete, goal: '' }, shareWithCoach: 'on' }, today)
    expect(parsed).toEqual({ ok: false, error: { goal: 'Answer this question.', consent: 'Tick the box to let ERC store your answers.' } })
  })

  it('shares with the coach only when asked', () => {
    const shared = parseIntakeSubmission({ answers: complete, consent: 'on', shareWithCoach: 'on' }, today)
    const unshared = parseIntakeSubmission({ answers: complete, consent: true }, today)
    expect([shared.ok && shared.value.shareWithCoach, unshared.ok && unshared.value.shareWithCoach]).toEqual([true, false])
  })
})

describe('showing answers', () => {
  it('writes each answer back into its form field so a saved intake re-submits unchanged', () => {
    const first = parseIntakeAnswers({ ...complete, recent10k: '1:01:00' }, today)
    if (!first.ok) throw new Error('fixture should parse')
    const fields = Object.fromEntries(INTAKE_QUESTIONS.map((q) => [q.key, intakeFieldValue(q.key, first.value[q.key as IntakeKey])]))
    expect(parseIntakeAnswers(fields, today)).toEqual(first)
  })

  it('shows a choice by its label and a number with its unit', () => {
    expect([intakeAnswerText('healthCondition', 'cardiovascular'), intakeAnswerText('weeklyKm', 25.5), intakeAnswerText('injuries', null)]).toEqual([
      'A heart or blood pressure condition',
      '25.5 km',
      null,
    ])
  })
})
