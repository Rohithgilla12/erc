import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "coaches" ADD COLUMN IF NOT EXISTS "member_id" integer REFERENCES "public"."members"("id") ON DELETE set null;
    ALTER TABLE "_coaches_v" ADD COLUMN IF NOT EXISTS "version_member_id" integer REFERENCES "public"."members"("id") ON DELETE set null;
    CREATE INDEX IF NOT EXISTS "coaches_member_idx" ON "coaches" ("member_id");
    CREATE INDEX IF NOT EXISTS "_coaches_v_version_member_idx" ON "_coaches_v" ("version_member_id");

    CREATE TABLE IF NOT EXISTS "coaching_links" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "athlete_member_id" integer NOT NULL REFERENCES "public"."members"("id") ON DELETE cascade,
      "coach_id" integer NOT NULL REFERENCES "public"."coaches"("id") ON DELETE cascade,
      "state" text NOT NULL CHECK ("state" IN ('requested', 'active', 'ended')),
      "requested_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "decided_at" timestamp(3) with time zone,
      "ended_at" timestamp(3) with time zone,
      "ended_by" text CHECK ("ended_by" IN ('athlete', 'coach', 'staff'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "coaching_links_active_athlete_idx" ON "coaching_links" ("athlete_member_id") WHERE state IN ('requested', 'active');
    CREATE INDEX IF NOT EXISTS "coaching_links_coach_state_idx" ON "coaching_links" ("coach_id", "state");

    CREATE TABLE IF NOT EXISTS "check_ins" (
      "member_id" integer NOT NULL REFERENCES "public"."members"("id") ON DELETE cascade,
      "week_start_date" date NOT NULL,
      "feeling" text NOT NULL CHECK ("feeling" IN ('great', 'good', 'tired', 'struggling', 'injured')),
      "niggles" text,
      "note" text,
      "submitted_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("member_id", "week_start_date")
    );

    CREATE TABLE IF NOT EXISTS "week_reviews" (
      "link_id" uuid NOT NULL REFERENCES "coaching_links"("id") ON DELETE cascade,
      "week_start_date" date NOT NULL,
      "watch" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
      "note" text,
      "shared_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      PRIMARY KEY ("link_id", "week_start_date")
    );

    ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "note" text;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "activities" DROP COLUMN IF EXISTS "note";
    DROP TABLE IF EXISTS "week_reviews" CASCADE;
    DROP TABLE IF EXISTS "check_ins" CASCADE;
    DROP INDEX IF EXISTS "coaching_links_coach_state_idx";
    DROP INDEX IF EXISTS "coaching_links_active_athlete_idx";
    DROP TABLE IF EXISTS "coaching_links" CASCADE;
    DROP INDEX IF EXISTS "_coaches_v_version_member_idx";
    DROP INDEX IF EXISTS "coaches_member_idx";
    ALTER TABLE "_coaches_v" DROP COLUMN IF EXISTS "version_member_id";
    ALTER TABLE "coaches" DROP COLUMN IF EXISTS "member_id";
  `)
}
