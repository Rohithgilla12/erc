import {
  goalLabel,
  PLAN_GOALS,
  PLAN_LEVEL_LABELS,
  SESSION_INTENSITY_LABELS,
  WEEK_DAYS,
  type SessionTarget,
} from '@erc/domain'

import { accessField, seoField, slugField } from '../editorial-fields'
import { optionsFrom, shownWhen } from '../fields'
import { defineEditorial } from '../kinds'

const TARGET_LABELS: Record<SessionTarget['kind'], string> = { distance: 'Distance', duration: 'Time', none: 'No target' }

export const TrainingPlans = defineEditorial({
  slug: 'trainingPlans',
  labels: { singular: 'Training plan', plural: 'Training plans' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'goal', 'level', '_status'],
    description: 'The plan length is the number of weeks you add; there is no separate duration to keep in step.',
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField({ from: 'title' }),
    {
      type: 'row',
      fields: [
        {
          name: 'goal',
          label: 'Goal distance',
          type: 'select',
          required: true,
          index: true,
          options: PLAN_GOALS.map((goal) => ({ value: goal, label: goalLabel(goal) })),
        },
        { name: 'level', type: 'select', required: true, index: true, options: optionsFrom(PLAN_LEVEL_LABELS) },
      ],
    },
    {
      name: 'prerequisites',
      type: 'textarea',
      required: true,
      admin: { description: 'What a runner should already manage, such as "30 minutes of easy running, three times a week".' },
    },
    { name: 'audience', label: 'Who it is for', type: 'textarea', required: true },
    { name: 'overview', type: 'richText', required: true },
    {
      name: 'weeks',
      type: 'array',
      required: true,
      minRows: 1,
      labels: { singular: 'Week', plural: 'Weeks' },
      admin: { initCollapsed: true },
      fields: [
        { name: 'focus', type: 'text', required: true, admin: { description: 'One line, such as "Build to 20 minutes of running".' } },
        {
          name: 'sessions',
          type: 'array',
          required: true,
          minRows: 1,
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'day', type: 'select', required: true, options: WEEK_DAYS.map((day) => ({ value: String(day), label: `Day ${day}` })) },
                { name: 'intensity', type: 'select', required: true, options: optionsFrom(SESSION_INTENSITY_LABELS) },
              ],
            },
            { name: 'title', type: 'text', required: true },
            {
              name: 'target',
              type: 'group',
              fields: [
                { name: 'kind', label: 'Measured by', type: 'select', required: true, defaultValue: 'duration', options: optionsFrom(TARGET_LABELS) },
                { name: 'metres', type: 'number', required: true, min: 1, admin: { condition: shownWhen('kind', 'distance') } },
                {
                  name: 'seconds',
                  type: 'number',
                  required: true,
                  min: 1,
                  admin: { condition: shownWhen('kind', 'duration'), description: '1800 is 30 minutes.' },
                },
              ],
            },
            { name: 'notes', type: 'textarea' },
          ],
        },
      ],
    },
    { name: 'strength', label: 'Strength guidance', type: 'richText' },
    { name: 'recovery', label: 'Recovery guidance', type: 'richText' },
    { name: 'coaches', type: 'relationship', relationTo: 'coaches', hasMany: true, required: true, minRows: 1 },
    accessField,
    {
      name: 'pdf',
      label: 'Printable PDF',
      type: 'relationship',
      relationTo: 'resources',
      admin: { position: 'sidebar', description: 'Optional. Readers download it through its Downloads entry.' },
    },
    seoField,
  ],
})
