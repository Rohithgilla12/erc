/** The only place a collection is classified. Admin group, access rules, lifecycle, and cache tags derive from membership. */
export const EDITORIAL_SLUGS = ['posts', 'videos', 'trainingPlans', 'resources', 'pages', 'coaches', 'topics'] as const
export const RECORD_SLUGS = ['races', 'athletes', 'results', 'subscribers', 'enquiries', 'media', 'staff', 'members', 'claims', 'profileChanges'] as const

export type EditorialSlug = (typeof EDITORIAL_SLUGS)[number]
export type RecordSlug = (typeof RECORD_SLUGS)[number]
export type ErcSlug = EditorialSlug | RecordSlug
