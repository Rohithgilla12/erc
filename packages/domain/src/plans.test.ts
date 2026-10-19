import { describe, expect, it } from 'vitest'
import {
  ALL_PLANS,
  ANONYMOUS,
  canAccess,
  comparePlans,
  goalLabel,
  parsePlanQuery,
  PLAN_GOALS,
  PLAN_LEVELS,
  planFacets,
  plansHref,
  planWeekCount,
  tapPlanChip,
  type PlanLevel,
  type PlanQuery,
  type PlanWeek,
} from './index'
import type { DistanceCategory } from './running'

const plan = (goal: DistanceCategory, level: PlanLevel, title = `${goal} ${level}`) => ({ goal, level, title })

describe('parsePlanQuery and plansHref', () => {
  it('reads one goal and one level, ignoring case and later values', () => {
    expect(parsePlanQuery({ goal: ['5K', '10k'], level: ' Beginner ' })).toEqual({ goal: '5k', level: 'beginner' })
  })

  it('drops values it does not know, so a hand-edited URL still shows plans', () => {
    expect(parsePlanQuery({ goal: 'ultra', level: 'elite', page: '2' })).toEqual(ALL_PLANS)
  })

  it('round-trips every view through one URL', () => {
    const views: PlanQuery[] = [null, ...PLAN_GOALS].flatMap((goal) => [null, ...PLAN_LEVELS].map((level) => ({ goal, level })))
    for (const view of views) {
      const href = plansHref(view)
      const search = href.split('?')[1]
      const params = Object.fromEntries(search ? search.split('&').map((pair) => pair.split('=')) : [])
      expect(parsePlanQuery(params)).toEqual(view)
    }
  })

  it('links the unfiltered view to the bare path', () => {
    expect(plansHref(ALL_PLANS)).toBe('/plans')
    expect(plansHref({ goal: 'half', level: 'advanced' })).toBe('/plans?goal=half&level=advanced')
  })
})

describe('tapPlanChip', () => {
  it('selects, replaces, and clears within one family and leaves the other alone', () => {
    const selected = tapPlanChip(ALL_PLANS, { family: 'goal', value: '5k' })
    expect(selected).toEqual({ goal: '5k', level: null })
    const replaced = tapPlanChip({ ...selected, level: 'beginner' }, { family: 'goal', value: '10k' })
    expect(replaced).toEqual({ goal: '10k', level: 'beginner' })
    expect(tapPlanChip(replaced, { family: 'level', value: 'beginner' })).toEqual({ goal: '10k', level: null })
  })
})

describe('planFacets', () => {
  const plans = [plan('5k', 'beginner'), plan('5k', 'intermediate'), plan('10k', 'beginner'), plan('marathon', 'advanced')]

  it('offers only goals some plan targets, in distance order', () => {
    expect(planFacets(plans, ALL_PLANS).goals).toEqual([
      { value: '5k', count: 2 },
      { value: '10k', count: 1 },
      { value: 'marathon', count: 1 },
    ])
  })

  it('counts what each chip leads to, so a selected chip counts the view after clearing it', () => {
    const facets = planFacets(plans, { goal: '5k', level: 'beginner' })
    expect(facets.goals).toEqual([
      { value: '5k', count: 2 },
      { value: '10k', count: 1 },
      { value: 'marathon', count: 0 },
    ])
    expect(facets.levels).toEqual({ beginner: 2, intermediate: 1, advanced: 0 })
  })

  it('keeps a selected goal no plan targets, so the runner can clear it', () => {
    expect(planFacets(plans, { goal: 'ultra-100k', level: null }).goals).toContainEqual({ value: 'ultra-100k', count: 4 })
  })
})

describe('comparePlans', () => {
  it('orders by goal distance, then level, then title', () => {
    const sorted = [plan('marathon', 'beginner'), plan('5k', 'advanced'), plan('5k', 'beginner', 'b'), plan('5k', 'beginner', 'a')]
      .sort(comparePlans)
      .map(({ goal, level, title }) => `${goal}/${level}/${title}`)
    expect(sorted).toEqual(['5k/beginner/a', '5k/beginner/b', '5k/advanced/5k advanced', 'marathon/beginner/marathon beginner'])
  })
})

describe('plan labels', () => {
  it('derives the duration from the weeks, never a stored number', () => {
    const week: PlanWeek = { focus: 'Base', sessions: [{ day: 1, title: 'Easy run', target: { kind: 'none' }, intensity: 'easy', notes: '' }] }
    expect(planWeekCount({ weeks: [week, week, week] })).toBe(3)
  })

  it('names every goal, including the two outside the PB slots', () => {
    expect(PLAN_GOALS.map(goalLabel)).not.toContain(undefined)
    expect(goalLabel('half')).toBe('Half marathon')
    expect(goalLabel('other')).toBe('Other distance')
  })
})

describe('canAccess', () => {
  it('lets anyone open a free plan or file', () => {
    expect(canAccess(ANONYMOUS, { kind: 'free' })).toBe(true)
  })
})
