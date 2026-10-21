import type { ChangeView, MyAthlete, OwnProfile } from '@erc/contract'
import { INDIAN_SUBDIVISIONS, PHOTO_MAX_BYTES, PHOTO_TYPES, PROFILE_FIELDS, subdivisionOf, VISIBILITY_KEYS, type TextProfileField, type VisibilityKey } from '@erc/domain'
import type { Metadata } from 'next'
import Image from 'next/image'
import React from 'react'

import { claimProfile, savePhoto, saveProfile, saveVisibility, startProfile } from '@/members/actions'
import { requireMember, run } from '@/members/run'

import { ProfileForm, type FormField } from './profile-form'

import '../members.css'

export const metadata: Metadata = { title: 'My athlete profile', robots: { index: false, follow: false } }

type Props = { searchParams: Promise<{ q?: string | string[] }> }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? ''

const STATES = INDIAN_SUBDIVISIONS.map(({ code, name }) => ({ value: code, label: name }))

const HINTS: Partial<Record<TextProfileField, string>> = {
  name: 'As it should appear on the site.',
  birthYear: 'Never shown to anyone. Used only to place you in an age group.',
}

const textField = (name: TextProfileField, extra: { required?: boolean } = {}): FormField => {
  const { label } = PROFILE_FIELDS[name]
  const hint = HINTS[name]
  if (name === 'state') return { kind: 'select', name, label, options: STATES, required: true, ...(hint ? { hint } : {}) }
  if (name === 'bio') return { kind: 'textarea', name, label, maxLength: 400, ...(hint ? { hint } : {}), ...extra }
  if (name === 'runningSince' || name === 'birthYear') return { kind: 'year', name, label, ...(hint ? { hint } : {}), ...extra }
  return { kind: 'text', name, label, maxLength: 80, ...(hint ? { hint } : {}), ...extra }
}

const PROFILE_FORM: readonly FormField[] = [
  textField('name', { required: true }),
  textField('city'),
  textField('state'),
  textField('runningSince'),
  textField('birthYear'),
  textField('bio'),
]

const VISIBILITY_LABELS: Record<VisibilityKey, string> = { profile: 'Profile', results: 'Results and personal bests', mileage: 'Mileage on the leaderboards' }

const VISIBILITY_FORM: readonly FormField[] = VISIBILITY_KEYS.map((key) => ({
  kind: 'select',
  name: key,
  label: VISIBILITY_LABELS[key],
  required: true,
  options: [
    { value: 'hidden', label: 'Hidden' },
    { value: 'public', label: 'Public' },
  ],
}))

const PHOTO_UPLOAD: readonly FormField[] = [
  { kind: 'file', name: 'photo', label: 'New photo', accept: PHOTO_TYPES.join(','), required: true, hint: `JPEG, PNG or WebP, up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB.` },
]
const PHOTO_REMOVE: readonly FormField[] = [{ kind: 'hidden', name: 'photo', value: 'none' }]

function Photo({ url, label }: { url: string; label: string }) {
  return <Image className="member-photo" src={url} alt={label} width={96} height={96} unoptimized />
}

const stateName = (code: Parameters<typeof subdivisionOf>[0]) => subdivisionOf(code).name

const valuesOf = (profile: OwnProfile): Record<string, string> => {
  const { values } = profile
  return {
    name: values.name,
    bio: values.bio,
    city: values.city ?? '',
    state: values.state,
    runningSince: values.runningSince === null ? '' : String(values.runningSince),
    birthYear: values.birthYear === null ? '' : String(values.birthYear),
  }
}

function Changes({ changes }: { changes: readonly ChangeView[] }) {
  if (changes.length === 0) return null
  return (
    <ul className="member-changes" aria-label="Changes for review">
      {changes.map((change) => (
        <li key={change.field} className="member-change">
          <strong>{PROFILE_FIELDS[change.field].label}</strong>
          {change.state === 'submitted' ? (
            <span> is waiting for a coach to review it{change.field === 'photo' ? '.' : `: ${change.value}`}</span>
          ) : null}
          {change.state === 'submitted' && change.field === 'photo' && change.value ? <Photo url={change.value} label="The photo waiting for review" /> : null}
          {change.state === 'submitted' ? null : (
            <span>
              {' '}
              was not approved: {change.reason}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Profile({ profile }: { profile: OwnProfile }) {
  const { moderation } = profile
  return (
    <>
      <section aria-labelledby="status">
        <h2 id="status">Status</h2>
        {moderation.state === 'submitted' ? (
          <p>Your profile is waiting for a coach to review it. Nothing on it is public until then, and you can keep editing it.</p>
        ) : moderation.state === 'approved' ? (
          profile.publicPath ? (
            <p>
              Your profile is public at <a href={profile.publicPath}>{profile.publicPath}</a>.
            </p>
          ) : (
            <p>Your profile is approved and hidden. Nobody else can see it until you make it public below.</p>
          )
        ) : null}
      </section>

      <section aria-labelledby="details">
        <h2 id="details">Details</h2>
        {moderation.state === 'approved' ? (
          <p className="member-note">City, state and running since change at once. A new name or text about you is shown once a coach approves it; until then the profile keeps the old one.</p>
        ) : null}
        <Changes changes={profile.changes} />
        <ProfileForm id="profile" action={saveProfile} fields={PROFILE_FORM} initial={valuesOf(profile)} submit="Save details" />
      </section>

      <section aria-labelledby="photo">
        <h2 id="photo">Photo</h2>
        <p className="member-note">
          A photo is shown only after a coach reviews it. The file is stored on the club&apos;s media host, where anyone who has its address can open it, even before
          review. Location and camera details are removed when you upload it.
        </p>
        {profile.values.photoUrl ? <Photo url={profile.values.photoUrl} label="Your current photo" /> : null}
        <ProfileForm id="photo-upload" action={savePhoto} fields={PHOTO_UPLOAD} initial={{}} submit="Upload photo" />
        {profile.values.photoUrl ? <ProfileForm id="photo-remove" action={savePhoto} fields={PHOTO_REMOVE} initial={{}} submit="Remove photo" /> : null}
      </section>

      <section aria-labelledby="visibility">
        <h2 id="visibility">What others can see</h2>
        <p className="member-note">Only you decide this. Hiding something takes it off the site straight away.</p>
        <ProfileForm id="show" action={saveVisibility} fields={VISIBILITY_FORM} initial={profile.visibility} submit="Save choices" />
      </section>
    </>
  )
}

async function FindOrStart({ q, caller, athlete }: { q: string; caller: Awaited<ReturnType<typeof requireMember>>; athlete: MyAthlete }) {
  const search = q ? await run('searchAthletes', caller, { q }) : null
  const rejected = athlete.kind === 'none' ? athlete.rejectedClaim : null
  return (
    <>
      {rejected ? (
        <p className="member-alert" role="alert">
          Your claim on {rejected.athleteName} was not approved: {rejected.reason}
        </p>
      ) : null}
      {athlete.kind === 'profile' && athlete.profile.moderation.state === 'rejected' ? (
        <div className="member-alert" role="alert">
          <p>The profile you started was not approved: {athlete.profile.moderation.reason}</p>
          <p>You can claim a profile or start again below.</p>
        </div>
      ) : null}

      <section aria-labelledby="find">
        <h2 id="find">Find the profile a coach made for you</h2>
        <form className="member-form" method="get" action="/me/athlete#find">
          <label className="member-field">
            <span>Your name</span>
            <input name="q" type="search" minLength={3} required defaultValue={q} />
          </label>
          <div className="member-row">
            <button className="button" type="submit">
              Search
            </button>
          </div>
        </form>
        {search && !search.ok ? (
          <p className="member-alert" role="alert">
            {search.error.fields ? Object.values(search.error.fields).join(' ') : search.error.message}
          </p>
        ) : null}
        {search?.ok ? (
          search.data.items.length === 0 ? (
            <p className="member-note">No profile waiting to be claimed matches that name. You can start your own below.</p>
          ) : (
            <ul className="member-claims">
              {search.data.items.map((item) => (
                <li key={item.id} className="member-claim">
                  <p>
                    <strong>{item.name}</strong>, {stateName(item.state)}
                  </p>
                  <ProfileForm
                    id={`claim-${item.id}`}
                    action={claimProfile}
                    fields={[
                      { kind: 'hidden', name: 'athlete', value: String(item.id) },
                      { kind: 'textarea', name: 'note', label: 'How can the coach tell this is you?', required: true, maxLength: 500, hint: 'For example, a race you ran with the club.' },
                    ]}
                    initial={{}}
                    submit="Claim this profile"
                  />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section aria-labelledby="start">
        <h2 id="start">Or start a new profile</h2>
        <p className="member-note">A coach reviews it before it can go on the site, and every part stays hidden until you choose to show it.</p>
        <ProfileForm id="new" action={startProfile} fields={PROFILE_FORM} initial={{}} submit="Send for review" />
      </section>
    </>
  )
}

export default async function MyAthletePage({ searchParams }: Props) {
  const caller = await requireMember()
  const q = first((await searchParams).q).trim()
  const mine = await run('myAthlete', caller, {})
  if (!mine.ok) {
    return (
      <div className="page member-page">
        <h1>My athlete profile</h1>
        <p className="member-alert" role="alert">
          {mine.error.message}
        </p>
      </div>
    )
  }
  const athlete = mine.data
  const linked = athlete.kind === 'profile' && athlete.profile.moderation.state !== 'rejected' ? athlete.profile : null
  return (
    <div className="page member-page">
      <header>
        <h1>My athlete profile</h1>
        <p className="member-lede">
          <a href="/me">Back to my running</a>
        </p>
      </header>
      {linked ? (
        <Profile profile={linked} />
      ) : athlete.kind === 'claim_pending' ? (
        <p>
          Your claim on <strong>{athlete.athlete.name}</strong>, {stateName(athlete.athlete.state)}, is waiting for a coach to review it. Once it is approved the profile is yours
          to edit and to show or hide.
        </p>
      ) : (
        <FindOrStart q={q} caller={caller} athlete={athlete} />
      )}
    </div>
  )
}
