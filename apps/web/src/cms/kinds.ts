import { buildConfig, type CollectionConfig, type Config, type Field } from 'payload'

import { isStaff } from './access'
import { approvedUnlessStaff, moderationField } from './moderation'
import { applyWorkflow, publishedUnlessStaff, workflowField } from './workflow'

/** The only place a collection is classified. Admin group, access rules, and lifecycle derive from membership. */
export const EDITORIAL_SLUGS = ['posts', 'videos', 'trainingPlans', 'resources', 'pages', 'coaches', 'topics'] as const
export const RECORD_SLUGS = ['races', 'athletes', 'results', 'subscribers', 'enquiries', 'media', 'staff'] as const

export type EditorialSlug = (typeof EDITORIAL_SLUGS)[number]
export type RecordSlug = (typeof RECORD_SLUGS)[number]
export type ErcSlug = EditorialSlug | RecordSlug

declare const built: unique symbol

type Classified = { readonly config: CollectionConfig } & (
  | { readonly kind: 'editorial'; readonly slug: EditorialSlug }
  | { readonly kind: 'record'; readonly slug: RecordSlug }
)

/** Only `defineEditorial` and `defineRecord` produce this, so a raw `CollectionConfig` cannot reach `buildErcConfig`. */
export type ErcCollection = Classified & { readonly [built]: true }

type WriteAccess = Pick<NonNullable<CollectionConfig['access']>, 'create' | 'update' | 'delete' | 'unlock'>

type SpecBase = Pick<CollectionConfig, 'hooks' | 'indexes' | 'labels' | 'defaultSort'> & {
  fields: Field[]
  admin?: Omit<NonNullable<CollectionConfig['admin']>, 'group'>
  /** Read access is never configurable; it comes from the kind. Writes default to staff only. */
  access?: WriteAccess
}

export type EditorialSpec = SpecBase & { slug: EditorialSlug }

/**
 * `moderated` rows are public once approved, `public` rows always, `private` rows never.
 * Only `moderated` carries the moderation group: staff accounts and media have nothing to approve.
 */
export type RecordVisibility = 'moderated' | 'public' | 'private'

export type RecordSpec = SpecBase &
  Pick<CollectionConfig, 'auth' | 'upload'> & { slug: RecordSlug; visibility: RecordVisibility }

const staffWrites: WriteAccess = { create: isStaff, update: isStaff, delete: isStaff }

export const defineEditorial = ({ slug, fields, admin, access, hooks, ...rest }: EditorialSpec): ErcCollection =>
  brand({
    kind: 'editorial',
    slug,
    config: {
      ...rest,
      slug,
      admin: { ...admin, group: 'Content' },
      access: { ...staffWrites, ...access, read: publishedUnlessStaff, readVersions: isStaff },
      versions: { drafts: true },
      fields: [...fields, workflowField],
      // Last, so the workflow is the final word on `_status` whatever earlier hooks wrote.
      hooks: { ...hooks, beforeChange: [...(hooks?.beforeChange ?? []), applyWorkflow] },
    },
  })

const readByVisibility = { moderated: approvedUnlessStaff, public: () => true, private: isStaff } as const

export const defineRecord = ({ slug, fields, admin, access, visibility, ...rest }: RecordSpec): ErcCollection =>
  brand({
    kind: 'record',
    slug,
    config: {
      ...rest,
      slug,
      admin: { ...admin, group: 'Records' },
      access: { ...staffWrites, ...access, read: readByVisibility[visibility] },
      fields: visibility === 'moderated' ? [...fields, moderationField] : fields,
    },
  })

export const buildErcConfig = ({ collections, ...config }: Omit<Config, 'collections'> & { collections: ErcCollection[] }) =>
  buildConfig({ ...config, collections: collections.map((collection) => collection.config) })

const brand = (collection: Classified) => collection as ErcCollection
