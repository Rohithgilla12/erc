import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Coaches } from './cms/collections/coaches'
import { Media } from './cms/collections/media'
import { raceCalendarIndexes, Races } from './cms/collections/races'
import { Staff } from './cms/collections/staff'
import { buildErcConfig } from './cms/kinds'
import { mediaStorage } from './cms/storage'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildErcConfig({
  admin: {
    user: 'staff',
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Staff, Media, Coaches, Races],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    afterSchemaInit: [raceCalendarIndexes],
  }),
  sharp,
  plugins: [mediaStorage()],
})
