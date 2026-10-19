import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Athletes } from './cms/collections/athletes'
import { Coaches } from './cms/collections/coaches'
import { Media } from './cms/collections/media'
import { raceCalendarIndexes, Races } from './cms/collections/races'
import { Results } from './cms/collections/results'
import { Staff } from './cms/collections/staff'
import { buildErcConfig } from './cms/kinds'
import { revalidateEndpoint } from './cms/revalidate'
import { mediaStorage } from './cms/storage'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildErcConfig({
  admin: {
    user: 'staff',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Staff, Media, Coaches, Races, Athletes, Results],
  endpoints: [revalidateEndpoint],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    // Migrations are the only schema path in every environment, so hand-written SQL in them is never undone by a dev push.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    prodMigrations: migrations,
    afterSchemaInit: [raceCalendarIndexes],
  }),
  sharp,
  plugins: [mediaStorage()],
})
