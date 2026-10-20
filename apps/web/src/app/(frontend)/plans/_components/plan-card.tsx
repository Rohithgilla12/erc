import type { TrainingPlan } from '@erc/domain'
import React from 'react'

import { accessLabel, planLabels } from './format'

export function PlanCard({ plan, headingLevel = 'h2' }: { plan: TrainingPlan; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel
  return (
    <li className="plan-card">
      <Heading>
        <a href={`/plans/${plan.slug}`}>{plan.title}</a>
      </Heading>
      <ul className="plan-tags" aria-label="Plan details">
        {planLabels(plan).map((label) => (
          <li key={label}>{label}</li>
        ))}
        <li className="plan-tag-access">{accessLabel(plan.access)}</li>
      </ul>
      <dl className="plan-card-facts">
        <dt>Who it is for</dt>
        <dd>{plan.audience}</dd>
        <dt>Before you start</dt>
        <dd>{plan.prerequisites}</dd>
      </dl>
    </li>
  )
}
