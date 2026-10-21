import { describe, expect, it } from 'vitest'

import {
  checkClaimTarget,
  freeSlug,
  parseAthleteSearch,
  parseClaim,
  parseNewProfile,
  parsePhoto,
  parseProfileEdit,
  parseVisibilityEdit,
  planLink,
  planProfileEdit,
  PROFILE_FIELDS,
  slugFromName,
  type LocalDate,
  type MediaId,
  type ProfileValues,
  type Slug,
} from './index'

const today = '2026-10-21' as LocalDate

const live: ProfileValues = {
  name: 'Priya Reddy',
  bio: 'Trail runner.',
  photo: 7 as MediaId,
  city: 'Hyderabad',
  state: 'IN-TS',
  runningSince: 2015,
  birthYear: 1990,
}

describe('PROFILE_FIELDS', () => {
  it('reviews exactly the public words and picture, keeps birth year private, and lets the rest change at once', () => {
    const rules = Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([key, spec]) => [key, spec.rule]))
    expect(rules).toEqual({ name: 'reviewed', bio: 'reviewed', photo: 'reviewed', city: 'direct', state: 'direct', runningSince: 'direct', birthYear: 'private' })
  })
})

describe('planProfileEdit', () => {
  it('applies every field at once before the profile is approved, because nothing of it is public yet', () => {
    const plan = planProfileEdit(false, live, { name: 'Priya R', bio: 'Road runner.', city: 'Warangal', birthYear: 1991 })
    expect(plan).toEqual({ apply: { name: 'Priya R', bio: 'Road runner.', city: 'Warangal', birthYear: 1991 }, propose: [], withdraw: [] })
  })

  it('once approved, sends new words for review and applies direct and private fields at once', () => {
    const plan = planProfileEdit(true, live, { name: 'Priya R', city: 'Warangal', state: 'IN-AP', runningSince: 2012, birthYear: 1991 })
    expect(plan).toEqual({
      apply: { city: 'Warangal', state: 'IN-AP', runningSince: 2012, birthYear: 1991 },
      propose: [{ field: 'name', value: 'Priya R' }],
      withdraw: [],
    })
  })

  it('applies a removal of a reviewed field at once and withdraws any change waiting for it', () => {
    expect(planProfileEdit(true, live, { bio: '' })).toEqual({ apply: { bio: '' }, propose: [], withdraw: ['bio'] })
    expect(planProfileEdit(true, live, { photo: null })).toEqual({ apply: { photo: null }, propose: [], withdraw: ['photo'] })
  })

  it('withdraws the pending change when a reviewed field is set back to its live value, and writes nothing', () => {
    expect(planProfileEdit(true, live, { name: 'Priya Reddy', city: 'Hyderabad' })).toEqual({ apply: {}, propose: [], withdraw: ['name'] })
  })

  it('sends a new photo for review', () => {
    expect(planProfileEdit(true, live, { photo: 9 as MediaId }).propose).toEqual([{ field: 'photo', value: 9 }])
  })
})

describe('parseProfileEdit', () => {
  it('changes only the fields the input names, and ignores fields a member may not set', () => {
    expect(parseProfileEdit({ city: '  Warangal ', member: 3, photo: 12, visibility: 'public' }, today)).toEqual({ ok: true, value: { city: 'Warangal' } })
  })

  it('takes years as numbers from JSON and clears a field sent as null or empty', () => {
    expect(parseProfileEdit({ runningSince: 2012, birthYear: null, city: '' }, today)).toEqual({ ok: true, value: { runningSince: 2012, birthYear: null, city: null } })
  })

  it('refuses an empty name, an unknown state, a future running year, and a birth year under 18', () => {
    const parsed = parseProfileEdit({ name: ' ', state: 'IN-XX', runningSince: '2027', birthYear: '2009' }, today)
    expect(parsed.ok ? [] : Object.keys(parsed.error).sort()).toEqual(['birthYear', 'name', 'runningSince', 'state'])
  })

  it('accepts a birth year of exactly 18 years ago', () => {
    expect(parseProfileEdit({ birthYear: '2008' }, today)).toEqual({ ok: true, value: { birthYear: 2008 } })
  })
})

describe('parseNewProfile', () => {
  it('needs a name and a state and leaves the rest empty', () => {
    expect(parseNewProfile({ name: 'Ravi Kumar', state: 'in-ka' }, today)).toEqual({
      ok: true,
      value: { name: 'Ravi Kumar', bio: '', city: null, state: 'IN-KA', runningSince: null, birthYear: null },
    })
    const missing = parseNewProfile({}, today)
    expect(missing.ok ? [] : Object.keys(missing.error).sort()).toEqual(['name', 'state'])
  })
})

describe('planLink', () => {
  it('lets a member with nothing claim or start', () => {
    expect(planLink({ kind: 'none' })).toEqual({ ok: true, value: { replaceRejected: false } })
  })

  it('refuses a second link while a claim is open or a profile is live or waiting', () => {
    expect(planLink({ kind: 'claim_pending' })).toEqual({ ok: false, error: 'claim_pending' })
    expect(planLink({ kind: 'profile', moderation: 'submitted' })).toEqual({ ok: false, error: 'has_profile' })
    expect(planLink({ kind: 'profile', moderation: 'approved' })).toEqual({ ok: false, error: 'has_profile' })
  })

  it('replaces a started profile that staff rejected', () => {
    expect(planLink({ kind: 'profile', moderation: 'rejected' })).toEqual({ ok: true, value: { replaceRejected: true } })
  })
})

describe('checkClaimTarget', () => {
  it('allows only an approved profile with no member and no open claim', () => {
    expect(checkClaimTarget({ moderation: 'approved', linked: false, openClaim: false })).toEqual({ ok: true, value: true })
    expect(checkClaimTarget({ moderation: 'approved', linked: false, openClaim: true })).toEqual({ ok: false, error: 'claim_open' })
    expect(checkClaimTarget({ moderation: 'approved', linked: true, openClaim: false })).toEqual({ ok: false, error: 'not_claimable' })
    expect(checkClaimTarget({ moderation: 'submitted', linked: false, openClaim: false })).toEqual({ ok: false, error: 'not_claimable' })
    expect(checkClaimTarget(null)).toEqual({ ok: false, error: 'not_claimable' })
  })
})

describe('claim and search input', () => {
  it('needs a profile id and a note', () => {
    expect(parseClaim({ athlete: '12', note: 'I ran Malnad in 2025.' })).toEqual({ ok: true, value: { athlete: 12, note: 'I ran Malnad in 2025.' } })
    const bad = parseClaim({ athlete: '12 OR 1=1', note: '' })
    expect(bad.ok ? [] : Object.keys(bad.error).sort()).toEqual(['athlete', 'note'])
  })

  it('searches only on three letters or more', () => {
    expect(parseAthleteSearch({ q: '  pri  ' })).toEqual({ ok: true, value: { q: 'pri' } })
    expect(parseAthleteSearch({ q: 'pr' }).ok).toBe(false)
  })

  it('reads a visibility edit of any of the three switches and nothing else', () => {
    expect(parseVisibilityEdit({ mileage: 'public' })).toEqual({ ok: true, value: { mileage: 'public' } })
    expect(parseVisibilityEdit({ profile: 'shown' }).ok).toBe(false)
    expect(parseVisibilityEdit({}).ok).toBe(false)
  })
})

describe('parsePhoto', () => {
  const file = (type: string, size: number) => ({ type, size, arrayBuffer: async () => new ArrayBuffer(size) })

  it('takes a JPEG, PNG or WebP image up to 5 MB, or `none` to remove the photo', () => {
    const photo = file('image/png', 1_000)
    expect(parsePhoto({ photo })).toEqual({ ok: true, value: { photo } })
    expect(parsePhoto({ photo: 'none' })).toEqual({ ok: true, value: { photo: null } })
  })

  it('refuses other types, empty and oversized files, and anything that is not a file', () => {
    expect(parsePhoto({ photo: file('image/svg+xml', 100) }).ok).toBe(false)
    expect(parsePhoto({ photo: file('image/jpeg', 0) }).ok).toBe(false)
    expect(parsePhoto({ photo: file('image/jpeg', 5 * 1024 * 1024 + 1) }).ok).toBe(false)
    expect(parsePhoto({ photo: 'https://example.com/me.jpg' }).ok).toBe(false)
    expect(parsePhoto({ photo: 12 }).ok).toBe(false)
  })
})

describe('slugs for started profiles', () => {
  it('drops accents and joins words', () => {
    expect(slugFromName('  Ánanya  D’Souza ')).toBe('ananya-d-souza')
    expect(slugFromName('प्रिया')).toBe('athlete')
  })

  it('takes the first free suffix', () => {
    expect(freeSlug('ravi' as Slug, new Set(['ravi', 'ravi-2']))).toBe('ravi-3')
    expect(freeSlug('ravi' as Slug, new Set())).toBe('ravi')
  })
})
