import { ANSWER_MAX, QUESTION_MAX } from '@erc/domain'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Question as QuestionDoc } from '@/payload-types'

import { staffOf } from '../access'
import { defineRecord } from '../kinds'

import { askedBy } from './claims'
import { writtenBy } from './reviews'

const answerOf = (doc: Partial<QuestionDoc> | undefined) => doc?.answer?.trim() ?? ''

/**
 * Owns who answered and when for a staff save in the admin: whatever the request sends for them is discarded, and a
 * changed answer is stamped with the staff member. A coach's answer comes from server code, which stamps the coach.
 */
const stampStaffAnswer: CollectionBeforeChangeHook<QuestionDoc> = ({ data, originalDoc, req }) => {
  const staff = staffOf(req)
  if (!staff) return data
  const kept = { answeredBy: originalDoc?.answeredBy ?? null, answeredAt: originalDoc?.answeredAt ?? null }
  const answer = data.answer === undefined ? answerOf(originalDoc) : answerOf(data)
  if (answer === answerOf(originalDoc)) return { ...data, ...kept }
  if (answer === '') return { ...data, answer: null, answeredBy: null, answeredAt: null }
  return { ...data, answer, answeredBy: { relationTo: 'staff', value: staff.id }, answeredAt: new Date().toISOString() }
}

/** A member's question about a race. Staff approve it to show it on the race page, and staff or a coach answer it. */
export const Questions = defineRecord({
  slug: 'questions',
  visibility: 'moderated',
  labels: { singular: 'Race question', plural: 'Race questions' },
  defaultSort: '-createdAt',
  access: { create: () => false },
  admin: {
    useAsTitle: 'text',
    defaultColumns: ['text', 'race', 'answeredAt', 'moderation.state', 'createdAt'],
    description: 'Questions members ask on race pages. Approve to show one; write an answer and save to answer it as the club.',
  },
  hooks: { beforeChange: [stampStaffAnswer] },
  fields: [
    { name: 'race', type: 'relationship', relationTo: 'races', required: true, index: true, ...askedBy },
    writtenBy,
    { name: 'text', label: 'Question', type: 'textarea', required: true, maxLength: QUESTION_MAX, ...askedBy },
    { name: 'answer', type: 'textarea', maxLength: ANSWER_MAX, admin: { description: 'Shown under the question once it is approved. Clear it to take the answer down.' } },
    { name: 'answeredBy', type: 'relationship', relationTo: ['staff', 'coaches'], admin: { readOnly: true } },
    { name: 'answeredAt', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
  ],
})
