import config from '@payload-config'
import {
  comparePlans,
  goalLabel,
  PLAN_LEVEL_LABELS,
  planWeekCount,
  type Metres,
  type PlanSession,
  type PlanWeek,
  type Result,
  type Seconds,
  type SessionTarget,
  type TrainingPlan,
  type WeekDay,
} from '@erc/domain'
import { unstable_cache } from 'next/cache'
import { getPayload, type Payload } from 'payload'
import { cache } from 'react'

import { collectionTag } from '@/cms/revalidate'
import type { TrainingPlan as PlanDoc } from '@/payload-types'

import { nonEmpty, parsing, present, publishedCoaches, publishedFields, richTextOf, type Logger } from './published'
import { publicResources } from './resources'

type SessionDoc = PlanDoc['weeks'][number]['sessions'][number]

const targetOf = (target: SessionDoc['target'], field: string): SessionTarget => {
  switch (target.kind) {
    case 'distance':
      return { kind: 'distance', metres: present(target.metres, `${field}.metres`) as Metres }
    case 'duration':
      return { kind: 'duration', seconds: present(target.seconds, `${field}.seconds`) as Seconds }
    case 'none':
      return { kind: 'none' }
  }
}

const sessionOf = (session: SessionDoc, field: string): PlanSession => ({
  day: Number(session.day) as WeekDay,
  title: nonEmpty(session.title, `${field}.title`),
  target: targetOf(session.target, `${field}.target`),
  intensity: session.intensity,
  notes: session.notes?.trim() ?? '',
})

const weekOf = (week: PlanDoc['weeks'][number], index: number): PlanWeek => {
  const [first, ...rest] = week.sessions.map((session, at) => sessionOf(session, `weeks.${index}.sessions.${at}`))
  return { focus: nonEmpty(week.focus, `weeks.${index}.focus`), sessions: [present(first, `weeks.${index}.sessions`), ...rest] }
}

/** Used when an editor leaves the SEO description empty: the labels the brief asks every plan to carry. */
const summaryOf = (plan: Pick<TrainingPlan, 'goal' | 'level' | 'weeks' | 'audience'>) =>
  `A free ${planWeekCount(plan)}-week ${PLAN_LEVEL_LABELS[plan.level].toLowerCase()} ${goalLabel(plan.goal)} training plan. ${plan.audience}`

/** The one mapping from a CMS document to the domain type. Anything unexpected names the field instead of throwing. */
export function parsePlanDoc(doc: PlanDoc, logger: Logger): Result<TrainingPlan, string> {
  return parsing(() => {
    const [first, ...rest] = doc.weeks.map(weekOf)
    const weeks: TrainingPlan['weeks'] = [present(first, 'weeks'), ...rest]
    const title = nonEmpty(doc.title, 'title')
    const audience = nonEmpty(doc.audience, 'audience')
    // An unpublished PDF arrives as a bare id; the plan still shows, without the download link.
    const pdf = typeof doc.pdf === 'object' && doc.pdf ? (publicResources([doc.pdf], logger)[0] ?? null) : null
    return {
      kind: 'trainingPlan',
      ...publishedFields(doc, { title, description: summaryOf({ goal: doc.goal, level: doc.level, weeks, audience }) }),
      title,
      goal: doc.goal,
      level: doc.level,
      prerequisites: nonEmpty(doc.prerequisites, 'prerequisites'),
      audience,
      overview: richTextOf(present(doc.overview, 'overview')),
      weeks,
      strength: doc.strength ? richTextOf(doc.strength) : null,
      recovery: doc.recovery ? richTextOf(doc.recovery) : null,
      coaches: publishedCoaches(doc.coaches),
      access: doc.access,
      pdf,
    }
  })
}

/** Uncached; routes call `getPlans`. Exported for scripts that run outside Next.js. */
export async function publishedPlans(payload: Payload): Promise<TrainingPlan[]> {
  // Depth 2 reaches the coaches' photos as well as the coaches, the PDF's download entry, and the SEO image, each only
  // if anonymous readers may see it.
  const { docs } = await payload.find({ collection: 'trainingPlans', overrideAccess: false, depth: 2, pagination: false })
  return docs
    .flatMap((doc) => {
      const parsed = parsePlanDoc(doc, payload.logger)
      if (parsed.ok) return [parsed.value]
      payload.logger.error({ plan: doc.id, slug: doc.slug, field: parsed.error }, 'Skipping a training plan that does not parse')
      return []
    })
    .sort(comparePlans)
}

const cachedPlans = unstable_cache(async () => publishedPlans(await getPayload({ config })), ['plans:all'], {
  // A plan page shows its coaches, its PDF, and its SEO image, so a change to any of them must expire it too.
  tags: (['trainingPlans', 'coaches', 'resources', 'media'] as const).map(collectionTag),
  revalidate: 3600,
})

/**
 * Every published plan, in `comparePlans` order. A club has a handful of plans, so one cached read serves the list,
 * every plan page, and unknown slugs, which then cost no query and add no cache entry.
 */
export const getPlans = cache(() => cachedPlans())

export const getPlan = cache(async (slug: string): Promise<TrainingPlan | null> => (await getPlans()).find((plan) => plan.slug === slug) ?? null)
