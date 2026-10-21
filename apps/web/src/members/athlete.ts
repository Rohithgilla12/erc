import { randomUUID } from 'node:crypto'

import { sql } from '@payloadcms/db-postgres/drizzle'
import type { ChangeView, ClaimableAthlete, MyAthlete, OwnProfile, ProfileModeration } from '@erc/contract'
import {
  checkClaimTarget,
  err,
  freeSlug,
  ok,
  planLink,
  planProfileEdit,
  SEARCH_LIMIT,
  slugFromName,
  VISIBILITY_KEYS,
  type AthleteStanding,
  type AthleteVisibility,
  type ClaimRefusal,
  type ClaimRequest,
  type Id,
  type LinkRefusal,
  type MediaId,
  type NewProfile,
  type ProfileValues,
  type Result,
  type ReviewedChange,
  type ReviewedField,
  type Slug,
  type Subdivision,
  type UploadedFile,
  type VisibilityEdit,
} from '@erc/domain'
import type { Payload } from 'payload'
import sharp from 'sharp'

import { idOf } from '@/cms/collections/claims'
import { deleteMemberPhoto, MEMBER_PHOTO_PREFIX } from '@/cms/collections/media'
import { mediaUrl } from '@/content/published'
import type { Athlete as AthleteDoc, Claim as ClaimDoc, ProfileChange as ProfileChangeDoc } from '@/payload-types'

import { instantOf, type MemberSession } from './session'

/** Why a member's athlete operation was refused. `run.ts` maps each to an API error. */
export type AthleteRefusal = LinkRefusal | ClaimRefusal | 'no_profile' | 'profile_rejected' | 'not_an_image' | 'busy'

type Mine = { athlete: AthleteDoc | null; latestClaim: ClaimDoc | null }

/**
 * Everything about the member's link, read with access overridden: members are not Payload users, and every query
 * here is keyed by the session's own member, so no input can point it at someone else's rows.
 */
async function mine(payload: Payload, session: MemberSession): Promise<Mine> {
  const [athletes, claims] = await Promise.all([
    payload.find({ collection: 'athletes', where: { member: { equals: session.member } }, depth: 1, limit: 1, overrideAccess: true }),
    payload.find({ collection: 'claims', where: { member: { equals: session.member } }, depth: 1, limit: 1, sort: '-createdAt', overrideAccess: true }),
  ])
  return { athlete: athletes.docs[0] ?? null, latestClaim: claims.docs[0] ?? null }
}

const standingOf = ({ athlete, latestClaim }: Mine): AthleteStanding => {
  if (athlete) return { kind: 'profile', moderation: athlete.moderation.state }
  return latestClaim?.moderation.state === 'submitted' ? { kind: 'claim_pending' } : { kind: 'none' }
}

// Claims are read at depth 1, and deleting an athlete deletes its claims, so the athlete is always there to read.
const claimedAthlete = (claim: ClaimDoc): AthleteDoc => {
  if (typeof claim.athlete !== 'object') throw new Error(`Claim ${claim.id} was read without its athlete`)
  return claim.athlete
}

const claimableOf = (athlete: AthleteDoc): ClaimableAthlete => ({ id: athlete.id as Id<'athletes'>, name: athlete.name, state: athlete.home.subdivision })

const liveValues = (doc: AthleteDoc): ProfileValues => ({
  name: doc.name,
  bio: doc.bio ?? '',
  photo: idOf(doc.photo) as MediaId | null,
  city: doc.home.city ?? null,
  state: doc.home.subdivision,
  runningSince: doc.runningSince ?? null,
  birthYear: doc.birthYear ?? null,
})

const visibilityOf = (doc: AthleteDoc): AthleteVisibility => ({ profile: doc.visibility.profile, results: doc.visibility.results, mileage: doc.visibility.mileage })

const moderationOf = (doc: AthleteDoc): ProfileModeration =>
  doc.moderation.state === 'rejected' ? { state: 'rejected', reason: doc.moderation.reason ?? '' } : { state: doc.moderation.state }

const changeValue = (doc: ProfileChangeDoc): string => (doc.field === 'photo' ? (typeof doc.photo === 'object' && doc.photo ? (mediaUrl(doc.photo) ?? '') : '') : (doc.text ?? ''))

/** The newest change per field, while it waits or was refused; an approved one is already the live value. */
async function changesOf(payload: Payload, athlete: AthleteDoc): Promise<ChangeView[]> {
  const { docs } = await payload.find({ collection: 'profileChanges', where: { athlete: { equals: athlete.id } }, depth: 1, sort: '-createdAt', pagination: false, overrideAccess: true })
  const newest = new Map<ReviewedField, ProfileChangeDoc>()
  for (const doc of docs) if (!newest.has(doc.field)) newest.set(doc.field, doc)
  return [...newest.values()].flatMap((doc): ChangeView[] => {
    const base = { field: doc.field, value: changeValue(doc), submittedAt: instantOf(doc.moderation.submittedAt ?? doc.createdAt) }
    if (doc.moderation.state === 'submitted') return [{ ...base, state: 'submitted' }]
    if (doc.moderation.state === 'rejected') return [{ ...base, state: 'rejected', reason: doc.moderation.reason ?? '' }]
    return []
  })
}

async function ownProfile(payload: Payload, doc: AthleteDoc): Promise<OwnProfile> {
  const { photo: _photo, ...values } = liveValues(doc)
  const shown = doc.moderation.state === 'approved' && doc.visibility.profile === 'public'
  return {
    id: doc.id as Id<'athletes'>,
    slug: doc.slug as Slug,
    moderation: moderationOf(doc),
    values: { ...values, photoUrl: mediaUrl(doc.photo) },
    visibility: visibilityOf(doc),
    publicPath: shown ? `/athletes/${doc.slug}` : null,
    changes: await changesOf(payload, doc),
  }
}

async function viewOf(payload: Payload, current: Mine): Promise<MyAthlete> {
  const { athlete, latestClaim } = current
  if (athlete) return { kind: 'profile', profile: await ownProfile(payload, athlete) }
  if (latestClaim?.moderation.state === 'submitted') return { kind: 'claim_pending', athlete: claimableOf(claimedAthlete(latestClaim)), note: latestClaim.note }
  if (latestClaim?.moderation.state === 'rejected') {
    return { kind: 'none', rejectedClaim: { athleteName: claimedAthlete(latestClaim).name, reason: latestClaim.moderation.reason ?? '' } }
  }
  return { kind: 'none', rejectedClaim: null }
}

export async function myAthlete(payload: Payload, session: MemberSession): Promise<MyAthlete> {
  return viewOf(payload, await mine(payload, session))
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Approved profiles nobody has linked, by name. Only the id, name and state leave the database. */
export async function searchClaimable(payload: Payload, q: string): Promise<ClaimableAthlete[]> {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT id, name, home_subdivision FROM athletes
    WHERE moderation_state = 'approved' AND member_id IS NULL AND name ILIKE ${likePattern(q)}
    ORDER BY name, id LIMIT ${SEARCH_LIMIT}`)
  return (rows as { id: number; name: string; home_subdivision: Subdivision }[]).map((row) => ({ id: row.id as Id<'athletes'>, name: row.name, state: row.home_subdivision }))
}

/** A started profile staff rejected is never public, so making way for a new link deletes it outright. */
const removeRejected = (payload: Payload, current: Mine) =>
  current.athlete?.moderation.state === 'rejected' ? payload.delete({ collection: 'athletes', id: current.athlete.id, overrideAccess: true }) : Promise.resolve()

/**
 * Claims and profile changes are written in SQL so the partial unique indexes decide a race: a second open claim, or
 * two at once, inserts nothing. Neither collection is public, so no cached read waits on their revalidation hooks.
 */
export async function claimAthlete(payload: Payload, session: MemberSession, request: ClaimRequest): Promise<Result<MyAthlete, AthleteRefusal>> {
  const current = await mine(payload, session)
  const link = planLink(standingOf(current))
  if (!link.ok) return link
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT a.moderation_state, a.member_id IS NOT NULL AS linked,
      EXISTS (SELECT 1 FROM claims c WHERE c.athlete_id = a.id AND c.moderation_state = 'submitted') AS open_claim
    FROM athletes a WHERE a.id = ${request.athlete}`)
  const found = rows[0] as { moderation_state: ProfileModeration['state']; linked: boolean; open_claim: boolean } | undefined
  const target = checkClaimTarget(found ? { moderation: found.moderation_state, linked: found.linked, openClaim: found.open_claim } : null)
  if (!target.ok) return target
  const inserted = await payload.db.drizzle.execute(sql`
    INSERT INTO claims (member_id, athlete_id, note, moderation_state, moderation_submitted_at)
    VALUES (${session.member}, ${request.athlete}, ${request.note}, 'submitted', now())
    ON CONFLICT DO NOTHING RETURNING id`)
  if (inserted.rows.length === 0) return err('busy')
  await removeRejected(payload, current)
  return ok(await myAthlete(payload, session))
}

async function slugFor(payload: Payload, name: string): Promise<Slug> {
  const base = slugFromName(name)
  const { rows } = await payload.db.drizzle.execute(sql`SELECT slug FROM athletes WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`)
  return freeSlug(base, new Set((rows as { slug: string }[]).map((row) => row.slug)))
}

const HIDDEN: AthleteVisibility = { profile: 'hidden', results: 'hidden', mileage: 'hidden' }

/** A new profile, submitted for review and hidden in every part, owned by the member from the start. */
export async function startAthlete(payload: Payload, session: MemberSession, profile: NewProfile): Promise<Result<MyAthlete, AthleteRefusal>> {
  const current = await mine(payload, session)
  const link = planLink(standingOf(current))
  if (!link.ok) return link
  await removeRejected(payload, current)
  try {
    await payload.create({
      collection: 'athletes',
      overrideAccess: true,
      data: {
        name: profile.name,
        slug: await slugFor(payload, profile.name),
        bio: profile.bio,
        home: { city: profile.city, subdivision: profile.state },
        runningSince: profile.runningSince,
        birthYear: profile.birthYear,
        member: session.member,
        visibility: HIDDEN,
        leaderboards: 'included',
        moderation: { state: 'submitted' },
      },
    })
  } catch (error) {
    // The unique index on the member link refused a second profile created at the same moment.
    if (standingOf(await mine(payload, session)).kind !== 'none') return err('busy')
    throw error
  }
  return ok(await myAthlete(payload, session))
}

/** The member's own profile, ready to change, or why it cannot be changed. */
const editable = (current: Mine): Result<AthleteDoc, AthleteRefusal> => {
  const standing = standingOf(current)
  if (standing.kind === 'claim_pending') return err('claim_pending')
  if (!current.athlete) return err('no_profile')
  return current.athlete.moderation.state === 'rejected' ? err('profile_rejected') : ok(current.athlete)
}

const athleteData = (values: Partial<ProfileValues>, live: ProfileValues) => ({
  ...('name' in values ? { name: values.name } : {}),
  ...('bio' in values ? { bio: values.bio } : {}),
  ...('photo' in values ? { photo: values.photo } : {}),
  ...('runningSince' in values ? { runningSince: values.runningSince } : {}),
  ...('birthYear' in values ? { birthYear: values.birthYear } : {}),
  ...('city' in values || 'state' in values
    ? { home: { city: 'city' in values ? values.city : live.city, subdivision: values.state ?? live.state } }
    : {}),
})

async function propose(payload: Payload, session: MemberSession, athlete: number, change: ReviewedChange): Promise<number | null> {
  const text = change.field === 'photo' ? null : change.value
  const photo = change.field === 'photo' ? change.value : null
  const { rows } = await payload.db.drizzle.execute(sql`
    WITH previous AS (
      SELECT photo_id FROM profile_changes WHERE athlete_id = ${athlete} AND field = ${change.field} AND moderation_state = 'submitted'
    )
    INSERT INTO profile_changes (member_id, athlete_id, field, text, photo_id, moderation_state, moderation_submitted_at)
    VALUES (${session.member}, ${athlete}, ${change.field}, ${text}, ${photo}, 'submitted', now())
    ON CONFLICT (athlete_id, field) WHERE moderation_state = 'submitted'
    DO UPDATE SET text = EXCLUDED.text, photo_id = EXCLUDED.photo_id, moderation_submitted_at = now(), updated_at = now()
    RETURNING (SELECT photo_id FROM previous) AS replaced`)
  const replaced = (rows[0] as { replaced: number | null } | undefined)?.replaced ?? null
  return replaced === photo ? null : replaced
}

async function withdraw(payload: Payload, athlete: number, fields: readonly ReviewedField[]): Promise<(number | null)[]> {
  if (fields.length === 0) return []
  const { rows } = await payload.db.drizzle.execute(sql`
    DELETE FROM profile_changes WHERE athlete_id = ${athlete} AND moderation_state = 'submitted'
      AND field IN (${sql.join(fields.map((field) => sql`${field}`), sql`, `)})
    RETURNING photo_id`)
  return (rows as { photo_id: number | null }[]).map((row) => row.photo_id)
}

/**
 * Routes every changed field by PROFILE_FIELDS: direct and private fields, and anything before approval, are written
 * now through Payload so the public pages expire; reviewed fields of an approved profile wait as profile changes.
 */
export async function updateProfile(payload: Payload, session: MemberSession, edit: Partial<ProfileValues>): Promise<Result<MyAthlete, AthleteRefusal>> {
  const current = await mine(payload, session)
  const athlete = editable(current)
  if (!athlete.ok) return athlete
  const live = liveValues(athlete.value)
  const plan = planProfileEdit(athlete.value.moderation.state === 'approved', live, edit)
  const unused: (number | null)[] = await withdraw(payload, athlete.value.id, plan.withdraw)
  for (const change of plan.propose) unused.push(await propose(payload, session, athlete.value.id, change))
  if (Object.keys(plan.apply).length > 0) {
    await payload.update({ collection: 'athletes', id: athlete.value.id, data: athleteData(plan.apply, live), depth: 0, overrideAccess: true })
    if ('photo' in plan.apply) await deleteMemberPhoto(payload, live.photo)
  }
  // Photos only a withdrawn or replaced change pointed at; nobody approved showing them.
  for (const id of unused) await deleteMemberPhoto(payload, id)
  return ok(await myAthlete(payload, session))
}

/**
 * Re-encoded rather than stored as sent: the WebP sharp writes carries none of the original's metadata, so a phone's
 * GPS position never reaches the club's media host, and a file that is not really an image fails here.
 */
const webpOf = async (file: UploadedFile): Promise<Buffer | null> => {
  try {
    return await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
  } catch {
    return null
  }
}

/** A new photo goes through the same routing as any reviewed field; `null` takes the current one off at once. */
export async function setPhoto(payload: Payload, session: MemberSession, photo: UploadedFile | null): Promise<Result<MyAthlete, AthleteRefusal>> {
  const athlete = editable(await mine(payload, session))
  if (!athlete.ok) return athlete
  if (photo === null) return updateProfile(payload, session, { photo: null })
  const image = await webpOf(photo)
  if (!image) return err('not_an_image')
  const media = await payload.create({
    collection: 'media',
    overrideAccess: true,
    data: { alt: `Photo of ${athlete.value.name}` },
    file: { data: image, mimetype: 'image/webp', name: `${MEMBER_PHOTO_PREFIX}${randomUUID()}.webp`, size: image.length },
  })
  return updateProfile(payload, session, { photo: media.id as MediaId })
}

/** Consent, the member's alone. Hiding writes through Payload, so the public pages and their caches expire at once. */
export async function setVisibility(payload: Payload, session: MemberSession, edit: VisibilityEdit): Promise<Result<MyAthlete, AthleteRefusal>> {
  const current = await mine(payload, session)
  const athlete = editable(current)
  if (!athlete.ok) return athlete
  const visibility = { ...visibilityOf(athlete.value), ...edit }
  if (VISIBILITY_KEYS.some((key) => visibility[key] !== athlete.value.visibility[key])) {
    await payload.update({ collection: 'athletes', id: athlete.value.id, data: { visibility }, depth: 0, overrideAccess: true })
  }
  return ok(await myAthlete(payload, session))
}
