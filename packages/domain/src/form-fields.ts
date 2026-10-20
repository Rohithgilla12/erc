import { err, ok, parseEmail, type Email, type Result } from './primitives'

/** Readers shared by the public form parsers. Each takes trimmed text and returns a value or a message for the reader. */
export type FieldResult<T> = Result<T, string>
export type FieldErrors = Readonly<Record<string, string>>
type Collected<R> = { [K in keyof R]: R[K] extends FieldResult<infer T> ? T : never }

export const valuesOf = (raw: unknown): string[] =>
  typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []

export const firstOf = (raw: unknown): string => valuesOf(raw)[0]?.trim() ?? ''

/** Every field's value, or every field's error keyed by field name. */
export const collect = <R extends Record<string, FieldResult<unknown>>>(fields: R): Result<Collected<R>, FieldErrors> => {
  const values: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const [key, result] of Object.entries(fields)) {
    if (result.ok) values[key] = result.value
    else errors[key] = result.error
  }
  return Object.keys(errors).length > 0 ? err(errors) : ok(values as Collected<R>)
}

export const textBetween = (raw: string, min: number, max: number, label: string): FieldResult<string> => {
  const length = Array.from(raw).length
  if (length === 0 && min > 0) return err(`Enter ${label}.`)
  return length >= min && length <= max ? ok(raw) : err(`Use ${min} to ${max} characters for ${label}.`)
}

// Payload's email field validator, copied so that an address this accepts is one the CMS will store.
export const email = (raw: string): FieldResult<Email> => {
  const parsed = parseEmail(raw)
  return parsed.ok ? parsed : err('Enter an email address such as name@example.com.')
}

export const optional = <T>(raw: string, parse: (raw: string) => FieldResult<T>): FieldResult<T | null> =>
  raw === '' ? ok(null) : parse(raw)
