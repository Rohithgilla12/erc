import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

import { readSmtpSettings } from './email-settings'

const settings = readSmtpSettings(process.env)

/** Unset without SMTP, so Payload keeps its log-only stand-in and nothing tries to send. */
export const emailAdapter = () =>
  settings
    ? nodemailerAdapter({
        defaultFromName: settings.fromName,
        defaultFromAddress: settings.fromAddress,
        // Port 465 speaks TLS from the first byte; the others upgrade with STARTTLS.
        transportOptions: { host: settings.host, port: settings.port, secure: settings.port === 465, auth: { user: settings.user, pass: settings.pass } },
      })
    : undefined

/** Who hears about a new enquiry, or null when email is off or nobody is named. */
export const enquiryRecipient = (): string | null => (settings && process.env.ENQUIRY_NOTIFY_TO?.trim()) || null
