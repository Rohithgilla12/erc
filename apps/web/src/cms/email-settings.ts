const SMTP_VARIABLES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'] as const

export type SmtpSettings = { host: string; port: number; user: string; pass: string; fromName: string; fromAddress: string }

const NAMED_ADDRESS = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/
const BARE_ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/

/**
 * All five set means SMTP; none set means no email. A partial set is a deploy mistake, so it fails loudly. Kept free
 * of the mail library so the server's start-up check can call it.
 */
export const readSmtpSettings = (env: NodeJS.ProcessEnv): SmtpSettings | null => {
  const missing = SMTP_VARIABLES.filter((name) => !env[name])
  if (missing.length === SMTP_VARIABLES.length) return null
  if (missing.length > 0) throw new Error(`Email is partly configured. Set ${missing.join(', ')}, or unset all five.`)
  const port = Number(env.SMTP_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`SMTP_PORT must be a port number, not ${env.SMTP_PORT}`)
  const from = env.EMAIL_FROM!
  const named = NAMED_ADDRESS.exec(from)
  if (!named && !BARE_ADDRESS.test(from.trim())) throw new Error('EMAIL_FROM must be an address, or a name and an address as "Name <address>"')
  return {
    host: env.SMTP_HOST!,
    port,
    user: env.SMTP_USER!,
    pass: env.SMTP_PASS!,
    fromName: named?.[1] || 'Endurance Run Club',
    fromAddress: named?.[2] ?? from.trim(),
  }
}
