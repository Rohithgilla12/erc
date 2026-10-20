/**
 * Gets a request past the API gate in `src/proxy.ts` without signing in. Payload rejects the token and treats the
 * request as anonymous, so its own access rules alone decide what comes back.
 */
export const FORGED_SESSION = { cookie: 'payload-token=forged' } as const
