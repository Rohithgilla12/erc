import { parseLocalDate } from '@erc/domain'
import type { TextField, TextFieldSingleValidation } from 'payload'
import { text } from 'payload/shared'

/** Select options from a label record; the explicit key type makes the compiler reject a missing or extra value. */
export const optionsFrom = <K extends string>(labels: Readonly<Record<K, string>>) =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }))

/** A domain `{ key, label }` list as the label record `optionsFrom` takes. */
export const labelsOf = <K extends string>(list: readonly { readonly key: K; readonly label: string }[]) =>
  Object.fromEntries(list.map(({ key, label }) => [key, label])) as Record<K, string>

/**
 * Admin condition for one variant of a stored union. Payload skips validation of a hidden field and keeps its
 * column nullable, so `required: true` plus this condition means "required for this variant only".
 */
export const shownWhen =
  (discriminant: string, ...variants: string[]) =>
  (_data: unknown, sibling: Partial<Record<string, unknown>>) => {
    const value = sibling[discriminant]
    return typeof value === 'string' && variants.includes(value)
  }

const textMatching =
  (accepts: (value: string) => boolean, message: string): TextFieldSingleValidation =>
  (value, args) => {
    const base = text(value, args)
    if (base !== true || value == null || value === '') return base
    return accepts(value) || message
  }

type TextOptions = { required?: boolean; index?: boolean; condition?: ReturnType<typeof shownWhen> }

export const localDateField = (name: string, { condition, ...options }: TextOptions = {}): TextField => ({
  name,
  type: 'text',
  admin: { placeholder: 'YYYY-MM-DD', condition },
  validate: textMatching((value) => parseLocalDate(value).ok, 'Use a calendar date such as 2026-12-31'),
  ...options,
})

export const httpsUrlField = (name: string, { condition, ...options }: TextOptions = {}): TextField => ({
  name,
  type: 'text',
  admin: { condition },
  validate: textMatching(isHttpsUrl, 'Use a full https:// link'),
  ...options,
})

function isHttpsUrl(raw: string) {
  try {
    return new URL(raw).protocol === 'https:'
  } catch {
    return false
  }
}
