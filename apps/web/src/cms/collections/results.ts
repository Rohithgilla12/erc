import {
  categoriseDistance,
  formatFinishTime,
  parseFinishTime,
  todayIn,
  type Athlete,
  type DistanceCategory,
  type Metres,
  type Moderation,
  type ResultProvenance,
  type Seconds,
} from '@erc/domain'
import { ValidationError, type CollectionBeforeValidateHook, type PayloadRequest, type TextFieldSingleValidation } from 'payload'

import type { Result as ResultDoc } from '@/payload-types'

import { httpsUrlField, localDateField, optionsFrom, shownWhen } from '../fields'
import { defineRecord } from '../kinds'

const PUBLIC: Athlete['visibility']['profile'] = 'public'

const idOf = (value: number | { id: number } | null | undefined) => (typeof value === 'object' && value !== null ? value.id : value)

/** What the request sent, else what is stored when the request left it out, else the race's value. */
const sentStoredOrRace = <T,>(sent: T | null | undefined, stored: T | null | undefined, fromRace: T | undefined) =>
  sent || (sent === undefined ? stored : null) || fromRace

const raceOf = async (req: PayloadRequest, race: ResultDoc['race']) => {
  const id = idOf(race)
  if (id == null) return null
  return typeof race === 'object' && race !== null ? race : req.payload.findByID({ collection: 'races', id, depth: 0, req })
}

/**
 * Owns every derived field. A linked race fills an empty event name and date, `finishTime` is the only way to set
 * `time`, and `category` comes from the distance, multi-day when the linked race spans several days. Runs before
 * validation so the required stored fields are present by then.
 */
const deriveResultFields: CollectionBeforeValidateHook<ResultDoc> = async ({ data = {}, originalDoc, req }) => {
  const { finishTime, time: _sent, ...rest } = data as typeof data & { finishTime?: unknown }
  const race = await raceOf(req, rest.race === undefined ? originalDoc?.race : rest.race)
  const parsedTime = typeof finishTime === 'string' && finishTime.trim() ? parseFinishTime(finishTime) : null
  const time = parsedTime?.ok ? parsedTime.value : originalDoc?.time
  const metres = rest.distance ?? originalDoc?.distance
  const date = sentStoredOrRace(rest.date, originalDoc?.date, race?.dates.start)

  if (date && date > todayIn('Asia/Kolkata')) {
    throw new ValidationError({ errors: [{ message: 'A result cannot be dated in the future.', path: 'date' }] })
  }

  return {
    ...rest,
    ...(finishTime === undefined ? {} : { finishTime }),
    eventName: sentStoredOrRace(rest.eventName?.trim(), originalDoc?.eventName, race?.name),
    date,
    time,
    category: typeof metres === 'number' && metres > 0 ? categoriseDistance(metres as Metres, (race?.dates.dayCount ?? 1) > 1) : undefined,
    ...(rest.provenance ? { provenance: withOneUrl(rest.provenance) } : {}),
  }
}

/** Only the URL that belongs to the chosen kind is kept, so a switched kind cannot carry a stale link. */
const withOneUrl = (provenance: ResultDoc['provenance']): ResultDoc['provenance'] =>
  provenance.kind === 'official'
    ? { ...provenance, evidenceUrl: null }
    : { ...provenance, timingUrl: null }

const finishTimeInput: TextFieldSingleValidation = (value, { siblingData }) => {
  if (value == null || value === '') {
    return typeof (siblingData as { time?: unknown }).time === 'number' || 'Enter the finish time as h:mm:ss, such as 0:19:45'
  }
  return parseFinishTime(value).ok || 'Use hours, minutes and seconds, such as 0:19:45 or 27:03:10'
}

export const Results = defineRecord({
  slug: 'results',
  visibility: 'moderated',
  // A result is public only while its athlete's profile and results both are; hiding either hides it everywhere.
  publicWhere: {
    and: [
      { 'athlete.moderation.state': { equals: 'approved' satisfies Moderation['state'] } },
      { 'athlete.visibility.profile': { equals: PUBLIC } },
      { 'athlete.visibility.results': { equals: PUBLIC } },
    ],
  },
  admin: {
    useAsTitle: 'eventName',
    defaultColumns: ['eventName', 'athlete', 'date', 'finishTime', 'provenance.kind', 'moderation.state'],
  },
  defaultSort: '-date',
  hooks: { beforeValidate: [deriveResultFields] },
  fields: [
    { name: 'athlete', type: 'relationship', relationTo: 'athletes', required: true, index: true },
    {
      name: 'race',
      type: 'relationship',
      relationTo: 'races',
      admin: { description: 'Optional. When set, an empty event name and date are filled from the race.' },
    },
    { name: 'eventName', type: 'text', required: true, admin: { description: 'Filled from the race when left empty.' } },
    localDateField('date', { required: true }),
    { name: 'distance', label: 'Distance (metres)', type: 'number', required: true, min: 1, admin: { step: 1 } },
    {
      name: 'finishTime',
      type: 'text',
      virtual: true,
      validate: finishTimeInput,
      admin: { placeholder: 'h:mm:ss', description: 'Hours, minutes and seconds, such as 0:19:45 or 27:03:10.' },
      hooks: {
        afterRead: [({ siblingData }) => (typeof siblingData.time === 'number' ? formatFinishTime(siblingData.time as Seconds) : undefined)],
      },
    },
    { name: 'time', label: 'Finish time (seconds)', type: 'number', required: true, min: 1, admin: { hidden: true } },
    {
      name: 'category',
      type: 'select',
      admin: { readOnly: true, description: 'Set from the distance when you save.' },
      options: optionsFrom<DistanceCategory>({
        '5k': '5K',
        '10k': '10K',
        half: 'Half marathon',
        marathon: 'Marathon',
        'ultra-50k': '50K',
        'ultra-50mi': '50 miles',
        'ultra-100k': '100K',
        'ultra-100mi': '100 miles',
        'ultra-multiday': 'Multi-day ultra',
        other: 'Other',
      }),
    },
    {
      name: 'provenance',
      type: 'group',
      admin: { description: 'Official means the race published this result. Only official results show as verified.' },
      fields: [
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'official' satisfies ResultProvenance['kind'],
          options: optionsFrom<ResultProvenance['kind']>({ official: 'Official race result', self_reported: 'Self-reported' }),
        },
        httpsUrlField('timingUrl', { condition: shownWhen('kind', 'official') }),
        httpsUrlField('evidenceUrl', { condition: shownWhen('kind', 'self_reported') }),
      ],
    },
  ],
})
