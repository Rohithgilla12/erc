import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { Athletes } from './cms/collections/athletes'
import { Claims, memberRequestIndexes } from './cms/collections/claims'
import { Coaches } from './cms/collections/coaches'
import { Enquiries } from './cms/collections/enquiries'
import { Media } from './cms/collections/media'
import { Members } from './cms/collections/members'
import { Pages } from './cms/collections/pages'
import { ProfileChanges } from './cms/collections/profile-changes'
import { raceCalendarIndexes, Races } from './cms/collections/races'
import { Results } from './cms/collections/results'
import { Staff } from './cms/collections/staff'
import { Subscribers } from './cms/collections/subscribers'
import { Posts } from './cms/collections/posts'
import { Topics } from './cms/collections/topics'
import { Videos } from './cms/collections/videos'
import { HANDBOOK_PATH } from './cms/components/handbook/handbook-path'
import { emailAdapter } from './cms/email'
import { Resources } from './cms/collections/resources'
import { TrainingPlans } from './cms/collections/training-plans'
import { buildErcConfig } from './cms/kinds'
import { revalidateEndpoint } from './cms/revalidate'
import { mediaStorage } from './cms/storage'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildErcConfig({
  admin: {
    user: 'staff',
    components: {
      afterNavLinks: ['/cms/components/handbook/handbook-link#HandbookNavLink'],
      beforeDashboard: ['/cms/components/handbook/handbook-link#HandbookDashboardNote'],
      views: { handbook: { Component: '/cms/components/handbook/handbook-view#HandbookView', path: HANDBOOK_PATH, meta: { title: 'Admin handbook' } } },
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Staff, Media, Coaches, Races, Athletes, Results, Topics, Posts, Videos, Pages, Enquiries, Subscribers, Resources, TrainingPlans, Members, Claims, ProfileChanges],
  endpoints: [revalidateEndpoint],
  editor: lexicalEditor(),
  // Pages read through the Local API and the admin through REST, so GraphQL would only be one more public surface.
  graphQL: { disable: true },
  email: emailAdapter(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
      // Fail a request rather than queue it forever when every connection is busy.
      connectionTimeoutMillis: 5000,
    },
    // Migrations are the only schema path in every environment, so hand-written SQL in them is never undone by a dev push.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    prodMigrations: migrations,
    afterSchemaInit: [raceCalendarIndexes, memberRequestIndexes],
  }),
  sharp,
  plugins: [mediaStorage()],
})
