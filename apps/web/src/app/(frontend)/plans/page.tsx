import {
  goalLabel,
  isFiltered,
  matchesPlanQuery,
  PLAN_LEVEL_LABELS,
  PLAN_LEVELS,
  planFacets,
  plansHref,
  parsePlanQuery,
  tapPlanChip,
  type PlanChip,
  type PlanQuery,
  type QueryParams,
  type TrainingPlan,
} from '@erc/domain'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { getPlans } from '@/content/plans'
import { absoluteUrl } from '@/site-config'

import { CheckIcon } from '../races/_components/badges'
import { breadcrumbList, JsonLd } from '../structured-data'
import { PlanCard } from './_components/plan-card'

import '../races/_components/races.css'
import './_components/plans.css'

type Props = { searchParams: Promise<QueryParams> }

const DESCRIPTION =
  'Free running plans from Endurance Run Club coaches, labelled by level, goal distance, length, what you need before you start, and who each plan is for.'

/** Filtered views are noindex and point at the full list, so search engines see one plans page. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parsePlanQuery(await searchParams)
  return {
    title: 'Training plans',
    description: DESCRIPTION,
    alternates: { canonical: '/plans' },
    ...(isFiltered(query) ? { robots: { index: false, follow: true } } : {}),
  }
}

const itemList = (plans: readonly TrainingPlan[]) => ({
  '@type': 'ItemList',
  name: 'Training plans',
  itemListElement: plans.map((plan, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    url: absoluteUrl(`/plans/${plan.slug}`),
    name: plan.title,
  })),
})

const activeFilters = (query: PlanQuery) => [
  ...(query.goal ? [goalLabel(query.goal)] : []),
  ...(query.level ? [PLAN_LEVEL_LABELS[query.level]] : []),
]

export default async function PlansPage({ searchParams }: Props) {
  const query = parsePlanQuery(await searchParams)
  const plans = await getPlans()
  const shown = plans.filter((plan) => matchesPlanQuery(plan, query))
  const facets = planFacets(plans, query)
  const active = activeFilters(query)
  const chipHref = (chip: PlanChip) => plansHref(tapPlanChip(query, chip))

  return (
    <div className="page plans">
      {isFiltered(query) ? null : (
        <JsonLd
          data={{
            '@graph': [
              itemList(plans),
              breadcrumbList([
                { name: 'Home', path: '/' },
                { name: 'Training plans', path: '/plans' },
              ]),
            ],
          }}
        />
      )}
      <header className="plans-head">
        <h1>Training plans</h1>
        <p className="lede">
          Free plans from ERC coaches. Each one says who it is for and what you should manage before you start. Printable copies and
          checklists are on the <a href="/resources">downloads page</a>.
        </p>
      </header>

      {plans.length === 0 ? null : (
        <nav className="facets plan-facets" aria-label="Filter plans">
          <ChipGroup label="Goal">
            {facets.goals.map(({ value, count }) => (
              <Chip key={value} href={chipHref({ family: 'goal', value })} selected={query.goal === value} count={count}>
                {goalLabel(value)}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label="Level">
            {PLAN_LEVELS.map((value) => (
              <Chip key={value} href={chipHref({ family: 'level', value })} selected={query.level === value} count={facets.levels[value]}>
                {PLAN_LEVEL_LABELS[value]}
              </Chip>
            ))}
          </ChipGroup>
        </nav>
      )}

      <section className="plan-results" aria-label="Plans">
        <p className="result-count">
          <strong>{shown.length === 1 ? '1 plan' : `${shown.length} plans`}</strong>
          {active.length > 0 ? (
            <>
              <span className="active-filters">{active.join(' · ')}</span>
              <a href="/plans">Show all plans</a>
            </>
          ) : null}
        </p>
        {shown.length === 0 ? (
          <p className="empty">
            {plans.length === 0 ? 'Plans are on their way.' : 'No plan matches both filters yet.'} <a href="/plans">See every plan</a>.
          </p>
        ) : (
          <ol className="plan-list">
            {shown.map((plan) => (
              <PlanCard key={plan.slug} plan={plan} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="chip-group">
      <h2>{label}</h2>
      <ul className="chips">{children}</ul>
    </div>
  )
}

/** The race calendar's chip: a plain link, so filtering works without JavaScript and every view has a URL. */
function Chip({ href, selected, count, children }: { href: string; selected: boolean; count: number; children: ReactNode }) {
  const label = (
    <>
      {selected ? <CheckIcon /> : null}
      {children}
      <span className="count">{count}</span>
    </>
  )
  if (!selected && count === 0) {
    return (
      <li>
        <span className="chip" aria-disabled="true">
          {label}
        </span>
      </li>
    )
  }
  return (
    <li>
      <a className="chip" href={href} aria-current={selected ? 'true' : undefined} rel={href.includes('?') ? 'nofollow' : undefined}>
        {label}
      </a>
    </li>
  )
}
