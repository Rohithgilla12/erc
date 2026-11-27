import config from '@payload-config'
import { unstable_rethrow } from 'next/navigation'
import { getPayload } from 'payload'

import { loggableError } from './query-error'

export const ACTION_FAILED = 'Something went wrong. Try again.'

/**
 * Every member server action runs inside this. Next logs whatever an action throws, and a failed Drizzle query carries
 * the typed values in its message, so an unexpected error is logged here without them and replaced. A form action
 * passes `failed` to answer with its own state, so a form posted without JavaScript shows the notice instead of an
 * error page; any other action throws a plain error. Redirects and `notFound` pass straight through.
 */
export const guarded =
  <A extends unknown[], R>(action: (...args: A) => Promise<R>, failed?: (...args: A) => R) =>
  async (...args: A): Promise<R> => {
    try {
      return await action(...args)
    } catch (error) {
      unstable_rethrow(error)
      ;(await getPayload({ config })).logger.error({ err: loggableError(error) }, 'A member action failed')
      if (failed) return failed(...args)
      throw new Error(ACTION_FAILED)
    }
  }
