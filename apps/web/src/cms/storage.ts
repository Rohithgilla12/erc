import { s3Storage } from '@payloadcms/storage-s3'

const R2_VARIABLES = ['R2_BUCKET', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL'] as const

type R2Settings = Record<(typeof R2_VARIABLES)[number], string>

/** All five set means R2; none set means local disk. A partial set is a deploy mistake, so it fails loudly. */
const readR2Settings = (env: NodeJS.ProcessEnv): R2Settings | null => {
  const missing = R2_VARIABLES.filter((name) => !env[name])
  if (missing.length === R2_VARIABLES.length) return null
  if (missing.length > 0) throw new Error(`R2 storage is partly configured. Set ${missing.join(', ')}, or unset all five.`)
  return Object.fromEntries(R2_VARIABLES.map((name) => [name, env[name]])) as R2Settings
}

export const mediaStorage = (env: NodeJS.ProcessEnv = process.env) => {
  const r2 = readR2Settings(env)
  // The plugin stays registered when disabled so its `prefix` column exists everywhere and migrations match production.
  if (!r2) return s3Storage({ enabled: false, alwaysInsertFields: true, bucket: '', config: {}, collections: { media: true, resources: true } })
  const publicUrl = r2.R2_PUBLIC_URL.replace(/\/+$/, '')
  return s3Storage({
    alwaysInsertFields: true,
    bucket: r2.R2_BUCKET,
    config: {
      endpoint: r2.R2_ENDPOINT,
      region: 'auto',
      credentials: { accessKeyId: r2.R2_ACCESS_KEY_ID, secretAccessKey: r2.R2_SECRET_ACCESS_KEY },
    },
    collections: {
      media: {
        disablePayloadAccessControl: true,
        generateFileURL: ({ filename, prefix }) => [publicUrl, prefix, filename].filter(Boolean).join('/'),
      },
      // Read through Payload rather than the public domain, so `/downloads/[slug]` stays the only way in. The object
      // still sits in the public bucket; a paid file needs a private bucket (see the design doc's Downloads section).
      resources: { prefix: 'resources' },
    },
  })
}
