import {
  bandOf,
  categoriseDistance,
  DISCIPLINES,
  DISTANCE_BANDS,
  type DistanceCategory,
  type Metres,
  type RaceDistanceOption,
  type RaceLocation,
  type RaceSource,
  type RaceStatus,
} from '@erc/domain'
import { sql, type PostgresAdapterArgs } from '@payloadcms/db-postgres'
import { index } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { CollectionBeforeChangeHook } from 'payload'

import type { Race as RaceDoc } from '@/payload-types'

import { httpsUrlField, localDateField, optionsFrom, shownWhen } from '../fields'
import { defineRecord } from '../kinds'
import { INDIAN_SUBDIVISIONS } from '../subdivisions'

type Distances = NonNullable<RaceDoc['distances']>

/** `category` and `band` are derived from `metres` here and nowhere else; the admin shows them read-only. */
const deriveDistanceKeys: CollectionBeforeChangeHook<RaceDoc> = ({ data, originalDoc }) => {
  const distances: Distances | undefined = data.distances ?? originalDoc?.distances ?? undefined
  if (!distances) return data
  const multiDay = (data.dates?.dayCount ?? originalDoc?.dates?.dayCount ?? 1) > 1
  return {
    ...data,
    distances: distances.map((option) =>
      typeof option.metres === 'number' && option.metres > 0
        ? {
            ...option,
            category: categoriseDistance(option.metres as Metres, multiDay),
            band: bandOf(option.metres as Metres),
          }
        : option,
    ),
  }
}

export const Races = defineRecord({
  slug: 'races',
  visibility: 'moderated',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'dates.start', 'discipline', 'moderation.state'] },
  defaultSort: 'dates.start',
  hooks: { beforeChange: [deriveDistanceKeys] },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'discipline', type: 'select', required: true, index: true, options: [...DISCIPLINES] },
    {
      name: 'dates',
      type: 'group',
      fields: [
        localDateField('start', { required: true, index: true }),
        { name: 'dayCount', type: 'number', required: true, defaultValue: 1, min: 1 },
      ],
    },
    { name: 'timeZone', type: 'text', required: true, defaultValue: 'Asia/Kolkata' },
    {
      name: 'location',
      type: 'group',
      fields: [
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'venue',
          options: optionsFrom<RaceLocation['kind']>({ venue: 'Venue', virtual: 'Virtual' }),
        },
        { name: 'venue', type: 'text', required: true, admin: { condition: shownWhen('kind', 'venue') } },
        { name: 'city', type: 'text', required: true, admin: { condition: shownWhen('kind', 'venue') } },
        {
          name: 'subdivision',
          type: 'select',
          required: true,
          index: true,
          options: optionsFrom(INDIAN_SUBDIVISIONS),
          admin: { condition: shownWhen('kind', 'venue') },
        },
        {
          name: 'country',
          type: 'text',
          required: true,
          defaultValue: 'IN',
          admin: { condition: shownWhen('kind', 'venue') },
        },
      ],
    },
    {
      name: 'distances',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'metres', type: 'number', required: true, min: 1 },
        {
          name: 'category',
          type: 'select',
          admin: { readOnly: true },
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
        { name: 'band', type: 'select', admin: { readOnly: true }, options: DISTANCE_BANDS.map(({ key }) => key) },
        { name: 'elevationGainMetres', type: 'number', min: 0 },
        {
          name: 'terrain',
          type: 'select',
          options: optionsFrom<NonNullable<RaceDistanceOption['terrain']>>({
            road: 'Road',
            trail: 'Trail',
            mixed: 'Mixed',
            track: 'Track',
          }),
        },
        { name: 'cutoff', label: 'Cutoff (seconds)', type: 'number', min: 1 },
      ],
    },
    httpsUrlField('officialUrl', { required: true }),
    {
      name: 'registration',
      type: 'group',
      fields: [httpsUrlField('url', { required: true }), localDateField('closesOn')],
    },
    {
      name: 'status',
      type: 'group',
      fields: [
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'scheduled',
          options: optionsFrom<RaceStatus['kind']>({
            scheduled: 'Scheduled',
            postponed: 'Postponed',
            cancelled: 'Cancelled',
          }),
        },
        localDateField('newStart', { condition: shownWhen('kind', 'postponed') }),
      ],
    },
    {
      name: 'source',
      type: 'group',
      fields: [
        {
          name: 'kind',
          type: 'select',
          required: true,
          options: optionsFrom<RaceSource['kind']>({
            organiser: 'Organiser',
            'listing-site': 'Listing site',
            'runner-submission': 'Runner submission',
            'coach-knowledge': 'Coach knowledge',
          }),
        },
        {
          name: 'name',
          type: 'text',
          required: true,
          admin: { condition: shownWhen('kind', 'listing-site') },
        },
        httpsUrlField('url', { required: true, condition: shownWhen('kind', 'organiser', 'listing-site') }),
        {
          name: 'coach',
          type: 'relationship',
          relationTo: 'coaches',
          required: true,
          admin: { condition: shownWhen('kind', 'coach-knowledge') },
        },
      ],
    },
    localDateField('lastVerifiedOn', { required: true }),
    { name: 'summary', type: 'textarea', required: true },
  ],
})

type SchemaHook = NonNullable<PostgresAdapterArgs['afterSchemaInit']>[number]

/**
 * Indexes for the calendar's dominant read that Payload's field `index` cannot express:
 * a partial index, trigram GIN, and a composite on the array table.
 */
export const raceCalendarIndexes: SchemaHook = ({ schema, extendTable }) => {
  const races = schema.tables.races
  const distances = schema.tables.races_distances
  if (!races || !distances) throw new Error('races tables missing from the Drizzle schema')
  extendTable({
    table: races,
    extraConfig: (t) => ({
      races_approved_start_idx: index('races_approved_start_idx')
        .on(t.dates_start)
        .where(sql`moderation_state = 'approved'`),
      races_name_trgm_idx: index('races_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
      races_location_city_trgm_idx: index('races_location_city_trgm_idx').using(
        'gin',
        t.location_city.op('gin_trgm_ops'),
      ),
    }),
  })
  extendTable({
    table: distances,
    extraConfig: (t) => ({
      races_distances_band_parent_idx: index('races_distances_band_parent_idx').on(t.band, t._parentID),
    }),
  })
  return schema
}
