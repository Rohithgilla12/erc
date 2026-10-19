import { INDIAN_SUBDIVISIONS } from '@erc/domain'

export const subdivisionOptions = INDIAN_SUBDIVISIONS.map(({ code, name }) => ({ value: code, label: name }))
