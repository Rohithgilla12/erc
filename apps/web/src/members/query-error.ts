/**
 * Drizzle's failed-query error lists every bound value in its message and stack, and keeps them in `params`, so logging
 * it as is writes health answers, review bodies and emails to the log. These keep the query text and the Postgres code.
 */
type QueryError = Error & { query: string; params: unknown[] }

const isQueryError = (error: unknown): error is QueryError => error instanceof Error && 'query' in error && 'params' in error

const queryErrorIn = (error: unknown, depth = 0): QueryError | null =>
  isQueryError(error) ? error : error instanceof Error && depth < 3 ? queryErrorIn(error.cause, depth + 1) : null

/** The SQLSTATE the driver attached, such as `23503` for a missing foreign key. */
export const sqlStateOf = (error: unknown): string | null => {
  const cause = error instanceof Error ? error.cause : null
  const code = (cause as { code?: unknown } | null)?.code ?? (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}

/** What a log may hold of an error: a failed query becomes its text, its code and its stack frames, without values. */
export const loggableError = (error: unknown): unknown => {
  const failed = queryErrorIn(error)
  if (!failed) return error
  return {
    type: 'DrizzleQueryError',
    message: `Failed query: ${failed.query}`,
    code: sqlStateOf(failed),
    stack: (failed.stack ?? '').split('\n').filter((line) => line.trimStart().startsWith('at ')).join('\n'),
  }
}

/** Thrown in place of a failed intake query. It carries only the Postgres code: no values, no message, no cause. */
export class IntakeQueryFailed extends Error {
  constructor(readonly code: string | null) {
    super(`An intake query failed${code ? ` with SQLSTATE ${code}` : ''}`)
    this.name = 'IntakeQueryFailed'
  }
}
