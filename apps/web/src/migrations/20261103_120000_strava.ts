import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS strava_connections (
      member_id BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      athlete_id BIGINT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_expires_at TIMESTAMPTZ NOT NULL,
      scope TEXT NOT NULL DEFAULT 'read,activity:read',
      status TEXT NOT NULL DEFAULT 'connected',
      last_synced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_strava_athlete_id ON strava_connections(athlete_id);
    CREATE INDEX IF NOT EXISTS idx_strava_status ON strava_connections(status);
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS strava_connections CASCADE;
  `)
}
