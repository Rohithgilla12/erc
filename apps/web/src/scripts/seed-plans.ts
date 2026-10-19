/**
 * Seeds two placeholder training plans, a placeholder coach, and one placeholder PDF download for local work:
 * `pnpm payload run src/scripts/seed-plans.ts`. Re-running replaces exactly these documents, matched by slug, and
 * leaves everything else alone. Every session is a conservative placeholder for a coach to replace.
 */
import config from '@payload-config'
import type { PlanSession } from '@erc/domain'
import { getPayload, type RequiredDataFromCollectionSlug } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

import { minimalPdf } from './fixtures/pdf'

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed placeholder plans in production')

type PlanData = RequiredDataFromCollectionSlug<'trainingPlans'>
type WeekData = PlanData['weeks'][number]
type SessionData = WeekData['sessions'][number]

const COACH_SLUG = 'placeholder-coach'
const PDF_SLUG = 'beginner-5k-plan-pdf'
const PLAN_SLUGS = { fiveK: 'beginner-5k-placeholder', tenK: 'first-10k-placeholder' } as const

const paragraphs = (...texts: string[]) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: texts.map((text) => ({
      type: 'paragraph',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      textFormat: 0,
      textStyle: '',
      children: [{ type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }],
    })),
  },
})

type Target = SessionData['target']

const session = (
  day: PlanSession['day'],
  title: string,
  intensity: PlanSession['intensity'],
  target: Target,
  notes: string,
): SessionData => ({ day: String(day) as SessionData['day'], title, intensity, target, notes })

const minutes = (count: number): Target => ({ kind: 'duration', seconds: count * 60 })
const km = (count: number): Target => ({ kind: 'distance', metres: count * 1000 })
const NO_TARGET: Target = { kind: 'none' }

const strengthSession = (day: PlanSession['day']) =>
  session(day, 'Strength (placeholder)', 'strength', NO_TARGET, 'Placeholder: 15 minutes of simple bodyweight exercises your coach picks with you.')

/** Run and walk minutes per repeat, one row per week; the walk breaks shrink only once the runs have grown. */
const RUN_WALK = [
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
  [6, 2],
  [8, 2],
  [12, 1],
] as const

const fiveKWeeks: WeekData[] = [
  ...RUN_WALK.map(([run, walk], index): WeekData => {
    const runWalk = session(
      1,
      `Run ${run} min, walk ${walk} min (placeholder)`,
      'easy',
      minutes(20 + index),
      `Placeholder: repeat ${run} minute${run === 1 ? '' : 's'} of running and ${walk} minutes of walking. Keep the running easy enough to talk.`,
    )
    return {
      focus: `Placeholder: build to ${run}-minute runs`,
      sessions: [runWalk, strengthSession(3), { ...runWalk, day: '5' }, { ...runWalk, day: '7', title: `${runWalk.title} with a longer warm-up walk` }],
    }
  }),
  {
    focus: 'Placeholder: run your first 5K',
    sessions: [
      session(1, 'Easy run (placeholder)', 'easy', minutes(20), 'Placeholder: easy running with walk breaks whenever you want them.'),
      session(3, 'Easy run (placeholder)', 'easy', minutes(15), 'Placeholder: short and relaxed.'),
      session(6, '5K run (placeholder)', 'steady', km(5), 'Placeholder: an unhurried 5 km. Walking breaks are fine.'),
    ],
  },
]

const LONG_RUN_KM = [5, 5.5, 6, 6.5, 7, 7.5, 8, 6, 8.5, 10] as const

const tenKWeeks: WeekData[] = LONG_RUN_KM.map((longRun, index): WeekData => {
  const week = index + 1
  const last = week === LONG_RUN_KM.length
  return {
    focus: last ? 'Placeholder: run your first 10K' : week === 8 ? 'Placeholder: a lighter week' : `Placeholder: long run to ${longRun} km`,
    sessions: [
      session(1, 'Easy run (placeholder)', 'easy', minutes(last ? 25 : 30 + Math.min(index, 4) * 2), 'Placeholder: conversational pace throughout.'),
      week >= 4 && !last
        ? session(3, 'Steady run (placeholder)', 'steady', minutes(25), 'Placeholder: 10 easy minutes, 10 steady minutes, 5 easy minutes.')
        : session(3, 'Easy run (placeholder)', 'easy', minutes(25), 'Placeholder: conversational pace throughout.'),
      strengthSession(4),
      last
        ? session(6, '10K run (placeholder)', 'steady', km(10), 'Placeholder: start slower than feels necessary.')
        : session(6, 'Long run (placeholder)', 'long', km(longRun), 'Placeholder: slow and even. Walk breaks are fine.'),
    ],
  }
})

const describeTarget = (target: SessionData['target']) =>
  target.kind === 'distance' ? `${(target.metres ?? 0) / 1000} km` : target.kind === 'duration' ? `${(target.seconds ?? 0) / 60} min` : ''

const pdfLines = (title: string, weeks: readonly WeekData[]) => [
  `${title}`,
  'Placeholder content for local development. A coach will replace every session.',
  '',
  ...weeks.flatMap((week, index) => [
    `Week ${index + 1}: ${week.focus}`,
    ...week.sessions.map((item) => `    Day ${item.day}: ${item.title} ${describeTarget(item.target)}`.trimEnd()),
  ]),
]

const payload = await getPayload({ config })
const context = { skipRevalidation: true }

const seedEmail = 'seed@erc.invalid'
const existingStaff = await payload.find({ collection: 'staff', where: { email: { equals: seedEmail } }, limit: 1 })
const staff =
  existingStaff.docs[0] ??
  (await payload.create({ collection: 'staff', data: { email: seedEmail, password: `seed-${Date.now()}`, role: 'editor' } }))
// The editorial workflow stamps the acting editor. Payload's auth strategy tags the user with its collection; a Local
// API caller must do the same.
const user = { ...staff, collection: 'staff' as const }

// Plans point at the coach and the PDF, so they go first.
const removePlans = await payload.delete({ collection: 'trainingPlans', where: { slug: { in: Object.values(PLAN_SLUGS) } }, context })
const removeResources = await payload.delete({ collection: 'resources', where: { slug: { equals: PDF_SLUG } }, context })
const removeCoaches = await payload.delete({ collection: 'coaches', where: { slug: { equals: COACH_SLUG } }, context })
console.log(`Removed ${removePlans.docs.length} plans, ${removeResources.docs.length} downloads, ${removeCoaches.docs.length} coaches`)

const publish = { draft: false, context, user } as const

const coach = await payload.create({
  collection: 'coaches',
  data: { name: 'Placeholder Coach', slug: COACH_SLUG, credentials: 'Placeholder: credentials to be added by the club.', _status: 'published' },
  ...publish,
})

const fiveKTitle = 'Beginner 5K (placeholder)'
const pdf = minimalPdf(pdfLines(fiveKTitle, fiveKWeeks))
const resource = await payload.create({
  collection: 'resources',
  data: {
    title: 'Beginner 5K plan, printable (placeholder)',
    slug: PDF_SLUG,
    description: 'Placeholder: a one-page printable copy of the beginner 5K schedule.',
    category: 'plan-pdf',
    access: { kind: 'free' },
    _status: 'published',
  },
  file: { data: pdf, mimetype: 'application/pdf', name: 'beginner-5k-placeholder.pdf', size: pdf.length },
  ...publish,
})

const plans: PlanData[] = [
  {
    title: fiveKTitle,
    slug: PLAN_SLUGS.fiveK,
    goal: '5k',
    level: 'beginner',
    prerequisites: 'Placeholder: able to walk briskly for 30 minutes.',
    audience: 'Placeholder: new runners who want to run 5 km without stopping, over eight weeks.',
    overview: paragraphs(
      'Placeholder: three short run/walk sessions a week, with the running stretches growing a little each week.',
      'Placeholder: repeat a week whenever it felt hard. A coach will replace this text.',
    ),
    weeks: fiveKWeeks,
    strength: paragraphs('Placeholder: one short bodyweight session a week, chosen with your coach.'),
    recovery: paragraphs('Placeholder: leave at least one rest day between runs. A coach will replace this text.'),
    coaches: [coach.id],
    access: { kind: 'free' },
    pdf: resource.id,
    seo: { description: 'Placeholder: an eight-week run/walk plan for your first 5K.' },
    _status: 'published',
  },
  {
    title: 'First 10K (placeholder)',
    slug: PLAN_SLUGS.tenK,
    goal: '10k',
    level: 'intermediate',
    prerequisites: 'Placeholder: able to run 5 km without stopping, three times a week.',
    audience: 'Placeholder: runners who have finished a 5K and want to reach 10 km over ten weeks.',
    overview: paragraphs(
      'Placeholder: three runs and one strength session a week, with the long run growing by about half a kilometre a week.',
      'Placeholder: week 8 is lighter on purpose. A coach will replace this text.',
    ),
    weeks: tenKWeeks,
    strength: paragraphs('Placeholder: one short strength session a week, chosen with your coach.'),
    recovery: paragraphs('Placeholder: keep easy runs easy and take the lighter week. A coach will replace this text.'),
    coaches: [coach.id],
    access: { kind: 'free' },
    seo: { description: 'Placeholder: a ten-week plan from 5K to your first 10K.' },
    _status: 'published',
  },
]

for (const data of plans) {
  const plan = await payload.create({ collection: 'trainingPlans', data, ...publish })
  console.log(`Created ${plan.slug}: ${plan.weeks.length} weeks`)
}
console.log(`Created download ${resource.slug} (${pdf.length} bytes)`)

await refreshRunningSite(payload, (['coaches', 'resources', 'trainingPlans'] as const).map(collectionTag))
process.exit(0)
