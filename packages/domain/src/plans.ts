import { PLAN_LEVELS, type PlanLevel, type TrainingPlan } from './content'
import type { QueryParams } from './races'
import { DISTANCE_CATEGORIES, type DistanceCategory } from './running'

/** Every goal a plan can target, shortest first. Plan lists and goal chips follow this order. */
export const PLAN_GOALS = [
  ...DISTANCE_CATEGORIES.map(({ key }) => key),
  'ultra-multiday',
  'other',
] as const satisfies readonly DistanceCategory[]

const GOAL_LABELS = new Map<DistanceCategory, string>([
  ...DISTANCE_CATEGORIES.map(({ key, label }) => [key, label] as const),
  ['ultra-multiday', 'Multi-day ultra'],
  ['other', 'Other distance'],
])

export const goalLabel = (goal: DistanceCategory): string => GOAL_LABELS.get(goal) ?? goal

export const planWeekCount = (plan: Pick<TrainingPlan, 'weeks'>): number => plan.weeks.length

export const PLANS_PATH = '/plans'

/** One goal and one level at most: a club has a handful of plans, so a second value in a family never narrows usefully. */
export type PlanQuery = { goal: DistanceCategory | null; level: PlanLevel | null }

export const ALL_PLANS: PlanQuery = { goal: null, level: null }

export type PlanChip = { family: 'goal'; value: DistanceCategory } | { family: 'level'; value: PlanLevel }

const firstOf = (raw: unknown): string => {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const known = <T extends string>(values: readonly T[], raw: string): T | null => values.find((value) => value === raw) ?? null

/** Unknown values are dropped, so any query string parses to a valid query. */
export const parsePlanQuery = (params: QueryParams): PlanQuery => ({
  goal: known(PLAN_GOALS, firstOf(params.goal)),
  level: known(PLAN_LEVELS, firstOf(params.level)),
})

/** The inverse of `parsePlanQuery`, with a fixed parameter order so each view has one URL. */
export const plansHref = (query: PlanQuery): string => {
  const params = [
    ...(query.goal ? [`goal=${query.goal}`] : []),
    ...(query.level ? [`level=${query.level}`] : []),
  ]
  return params.length === 0 ? PLANS_PATH : `${PLANS_PATH}?${params.join('&')}`
}

export const isFiltered = (query: PlanQuery): boolean => query.goal !== null || query.level !== null

/** Tapping the selected chip clears its family; tapping another replaces it. */
export const tapPlanChip = (query: PlanQuery, chip: PlanChip): PlanQuery =>
  chip.family === 'goal'
    ? { ...query, goal: query.goal === chip.value ? null : chip.value }
    : { ...query, level: query.level === chip.value ? null : chip.value }

export const matchesPlanQuery = (plan: Pick<TrainingPlan, 'goal' | 'level'>, query: PlanQuery): boolean =>
  (query.goal === null || plan.goal === query.goal) && (query.level === null || plan.level === query.level)

type Sortable = Pick<TrainingPlan, 'goal' | 'level' | 'title'>

/** Shortest goal first, then easiest level, so a beginner reads down the list in the order they would progress. */
export const comparePlans = (a: Sortable, b: Sortable): number =>
  PLAN_GOALS.indexOf(a.goal) - PLAN_GOALS.indexOf(b.goal) ||
  PLAN_LEVELS.indexOf(a.level) - PLAN_LEVELS.indexOf(b.level) ||
  a.title.localeCompare(b.title)

export type PlanFacets = {
  /** Goals some plan targets, plus the selected goal, in `PLAN_GOALS` order. */
  goals: readonly { value: DistanceCategory; count: number }[]
  levels: Readonly<Record<PlanLevel, number>>
}

/** Each count is how many plans tapping that chip shows, so a selected chip counts the view after clearing it. */
export const planFacets = (plans: readonly Pick<TrainingPlan, 'goal' | 'level'>[], query: PlanQuery): PlanFacets => {
  const countAfter = (chip: PlanChip) => {
    const next = tapPlanChip(query, chip)
    return plans.filter((plan) => matchesPlanQuery(plan, next)).length
  }
  const offered = new Set(plans.map((plan) => plan.goal))
  return {
    goals: PLAN_GOALS.filter((goal) => offered.has(goal) || goal === query.goal).map((value) => ({
      value,
      count: countAfter({ family: 'goal', value }),
    })),
    levels: Object.fromEntries(PLAN_LEVELS.map((value) => [value, countAfter({ family: 'level', value })])) as Record<PlanLevel, number>,
  }
}
