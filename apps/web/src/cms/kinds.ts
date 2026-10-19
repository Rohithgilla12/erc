import { buildConfig, type CollectionConfig, type Config, type Field, type Where } from 'payload'

import { isStaff } from './access'
import {
  applyModeration,
  approvedMatchingUnlessStaff,
  approvedUnlessStaff,
  decisionFields,
  moderatedDelete,
  moderationField,
} from './moderation'
import { revalidateOnChange, revalidateOnDelete } from './revalidate'
import type { EditorialSlug, ErcSlug, RecordSlug } from './slugs'
import {
  applyWorkflow,
  captureEditorialSave,
  editorialDelete,
  editorialUpdate,
  publishedUnlessStaff,
  reviewRequestFields,
  workflowField,
} from './workflow'

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
  Pick<CollectionConfig, 'auth' | 'upload'> & { slug: RecordSlug } & (
    | {
        visibility: 'moderated'
        /** Narrows what the public reads beyond "approved", such as an athlete's own visibility choice. Staff read every row. */
        publicWhere?: Where
      }
    | { visibility: 'public' | 'private'; publicWhere?: never }
  )

const staffWrites: WriteAccess = { create: isStaff, update: isStaff, delete: isStaff }

type Hooks = NonNullable<CollectionConfig['hooks']>

/** Appended last on every collection, so no collection can forget to expire its cached reads. */
const withRevalidation = (slug: ErcSlug, hooks: Hooks = {}): Hooks => ({
  ...hooks,
  afterChange: [...(hooks.afterChange ?? []), revalidateOnChange(slug)],
  afterDelete: [...(hooks.afterDelete ?? []), revalidateOnDelete(slug)],
})

export const defineEditorial = ({ slug, fields, admin, access, hooks, ...rest }: EditorialSpec): ErcCollection =>
  brand({
    kind: 'editorial',
    slug,
    config: {
      ...rest,
      slug,
      admin: { ...admin, group: 'Content' },
      access: { ...staffWrites, update: editorialUpdate, delete: editorialDelete, ...access, read: publishedUnlessStaff, readVersions: isStaff },
      versions: { drafts: true },
      fields: [...fields, workflowField, ...reviewRequestFields],
      hooks: withRevalidation(slug, {
        ...hooks,
        beforeOperation: [...(hooks?.beforeOperation ?? []), captureEditorialSave],
        // Last, so the workflow is the final word on `_status` whatever earlier hooks wrote.
        beforeChange: [...(hooks?.beforeChange ?? []), applyWorkflow],
      }),
    },
  })

const readByVisibility = { moderated: approvedUnlessStaff, public: () => true, private: isStaff } as const

export const defineRecord = ({ slug, fields, admin, access, visibility, publicWhere, hooks, ...rest }: RecordSpec): ErcCollection =>
  brand({
    kind: 'record',
    slug,
    config: {
      ...rest,
      slug,
      admin: { ...admin, group: 'Records' },
      access: {
        ...staffWrites,
        ...(visibility === 'moderated' ? { delete: moderatedDelete } : {}),
        ...access,
        read: publicWhere ? approvedMatchingUnlessStaff(publicWhere) : readByVisibility[visibility],
      },
      hooks: withRevalidation(
        slug,
        visibility === 'moderated' ? { ...hooks, beforeChange: [...(hooks?.beforeChange ?? []), applyModeration] } : hooks,
      ),
      fields: visibility === 'moderated' ? [...fields, moderationField, ...decisionFields] : fields,
    },
  })

export const buildErcConfig = ({ collections, ...config }: Omit<Config, 'collections'> & { collections: ErcCollection[] }) =>
  buildConfig({ ...config, collections: collections.map((collection) => collection.config) })

const brand = (collection: Classified) => collection as ErcCollection
