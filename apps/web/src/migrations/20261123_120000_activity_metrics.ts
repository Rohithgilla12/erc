import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// Every metric table hangs off an activity row rather than off Strava, so a FIT upload can fill the same tables later,
// and deleting the activity (a Strava delete, a disconnect, a deauthorisation) removes its metrics with it.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS activity_metrics (
      member_id integer NOT NULL,
      source varchar NOT NULL,
      ref varchar NOT NULL,
      start_at timestamptz NOT NULL,
      elapsed_s integer NOT NULL CHECK (elapsed_s > 0),
      has_heartrate boolean NOT NULL,
      avg_hr smallint,
      max_hr smallint,
      avg_cadence_spm smallint,
      elevation_gain_m real,
      elev_high_m real,
      elev_low_m real,
      avg_speed_mps real,
      max_speed_mps real,
      calories integer,
      workout_type text CHECK (workout_type IN ('default', 'race', 'long', 'workout')),
      device_name text,
      detailed_at timestamptz,
      PRIMARY KEY (member_id, source, ref),
      FOREIGN KEY (member_id, source, ref) REFERENCES activities (member_id, source, ref) ON DELETE CASCADE,
      CHECK (has_heartrate = (avg_hr IS NOT NULL AND max_hr IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS activity_metrics_member_start_idx ON activity_metrics (member_id, start_at);

    CREATE TABLE IF NOT EXISTS activity_splits (
      member_id integer NOT NULL,
      source varchar NOT NULL,
      ref varchar NOT NULL,
      split_index smallint NOT NULL CHECK (split_index > 0),
      metres real NOT NULL,
      moving_s integer NOT NULL,
      elapsed_s integer NOT NULL,
      avg_hr smallint,
      elevation_diff_m real,
      pace_zone smallint,
      PRIMARY KEY (member_id, source, ref, split_index),
      FOREIGN KEY (member_id, source, ref) REFERENCES activities (member_id, source, ref) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_laps (
      member_id integer NOT NULL,
      source varchar NOT NULL,
      ref varchar NOT NULL,
      lap_index smallint NOT NULL CHECK (lap_index > 0),
      name text,
      metres real NOT NULL,
      moving_s integer NOT NULL,
      elapsed_s integer NOT NULL,
      avg_speed_mps real,
      max_speed_mps real,
      avg_hr smallint,
      max_hr smallint,
      avg_cadence_spm smallint,
      elevation_gain_m real,
      PRIMARY KEY (member_id, source, ref, lap_index),
      FOREIGN KEY (member_id, source, ref) REFERENCES activities (member_id, source, ref) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_best_efforts (
      member_id integer NOT NULL,
      source varchar NOT NULL,
      ref varchar NOT NULL,
      effort_index smallint NOT NULL CHECK (effort_index > 0),
      name text NOT NULL,
      metres real NOT NULL,
      moving_s integer NOT NULL,
      elapsed_s integer NOT NULL,
      pr_rank smallint CHECK (pr_rank BETWEEN 1 AND 3),
      PRIMARY KEY (member_id, source, ref, effort_index),
      FOREIGN KEY (member_id, source, ref) REFERENCES activities (member_id, source, ref) ON DELETE CASCADE
    );

    -- One row per activity with each stream as a native array: 2 bytes a sample for heart rate and cadence, 4 for the
    -- rest, where JSON would spend 4 to 9 characters. A long run's row passes 2 kB, so TOAST compresses it out of line.
    CREATE TABLE IF NOT EXISTS activity_streams (
      member_id integer NOT NULL,
      source varchar NOT NULL,
      ref varchar NOT NULL,
      time_s integer[] NOT NULL,
      distance_m real[] NOT NULL,
      heartrate_bpm smallint[],
      cadence_spm smallint[],
      velocity_mps real[],
      altitude_m real[],
      PRIMARY KEY (member_id, source, ref),
      FOREIGN KEY (member_id, source, ref) REFERENCES activities (member_id, source, ref) ON DELETE CASCADE,
      CHECK (cardinality(distance_m) = cardinality(time_s)),
      CHECK (heartrate_bpm IS NULL OR cardinality(heartrate_bpm) = cardinality(time_s)),
      CHECK (cadence_spm IS NULL OR cardinality(cadence_spm) = cardinality(time_s)),
      CHECK (velocity_mps IS NULL OR cardinality(velocity_mps) = cardinality(time_s)),
      CHECK (altitude_m IS NULL OR cardinality(altitude_m) = cardinality(time_s))
    );

    -- Keyed by Strava activity, not by activity row: a webhook create is queued before the run exists here.
    CREATE TABLE IF NOT EXISTS strava_jobs (
      id bigserial PRIMARY KEY,
      member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
      strava_activity_id bigint NOT NULL,
      kind text NOT NULL CHECK (kind IN ('detail', 'streams')),
      attempts integer NOT NULL DEFAULT 0,
      not_before timestamptz NOT NULL DEFAULT now(),
      enqueued_at timestamptz NOT NULL DEFAULT now(),
      last_error text,
      UNIQUE (strava_activity_id, kind)
    );
    CREATE INDEX IF NOT EXISTS strava_jobs_due_idx ON strava_jobs (not_before);
    CREATE INDEX IF NOT EXISTS strava_jobs_member_idx ON strava_jobs (member_id);
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS strava_jobs;
    DROP TABLE IF EXISTS activity_streams;
    DROP TABLE IF EXISTS activity_best_efforts;
    DROP TABLE IF EXISTS activity_laps;
    DROP TABLE IF EXISTS activity_splits;
    DROP TABLE IF EXISTS activity_metrics;
  `)
}
