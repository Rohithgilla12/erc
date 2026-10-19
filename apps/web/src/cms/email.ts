import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

import { readSmtpSettings } from './email-settings'

const settings = readSmtpSettings(process.env)

/** Unset without SMTP, so Payload keeps its log-only stand-in and nothing tries to send. */
export const emailAdapter = () =>
  settings
    ? nodemailerAdapter({
        defaultFromName: settings.fromName,
        defaultFromAddress: settings.fromAddress,
        transportOptions: {
          host: settings.host,
          port: settings.port,
          // Port 465 speaks TLS from the first byte. Elsewhere STARTTLS is required, so the password never goes out in clear.
          secure: settings.port === 465,
          requireTLS: settings.port !== 465,
          auth: { user: settings.user, pass: settings.pass },
          // A stalled relay should cost seconds, not Nodemailer's default minutes.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        },
      })
    : undefined

export const enquiryRecipient = (): string | null => (settings && process.env.ENQUIRY_NOTIFY_TO?.trim()) || null
