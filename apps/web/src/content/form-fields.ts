// Free of server code so the client forms can import it.

export const HONEYPOT_FIELD = 'website'

export const TOKEN_FIELD = 'formToken'

/** The first string value of each field, as the domain parsers take them. */
export const fieldsOf = (form: FormData): Record<string, string> => {
  const fields: Record<string, string> = {}
  for (const [key, value] of form) {
    if (typeof value === 'string' && !(key in fields)) fields[key] = value
  }
  return fields
}
