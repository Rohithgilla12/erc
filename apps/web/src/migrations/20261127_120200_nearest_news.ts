import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

// `home_city` holds a slug from the domain's CITIES table. It has no CHECK constraint, so adding a city is a code
// change and never a migration; the domain parser is the only writer.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "home_city" varchar;

    CREATE TYPE "public"."enum_news_status" AS ENUM('draft', 'published');
    CREATE TYPE "public"."enum__news_v_version_status" AS ENUM('draft', 'published');

    CREATE TABLE IF NOT EXISTS "news" (
      "id" serial PRIMARY KEY NOT NULL,
      "headline" varchar,
      "slug" varchar,
      "summary" varchar,
      "source_url" varchar,
      "source_name" varchar,
      "related_race_id" integer REFERENCES "public"."races"("id") ON DELETE set null,
      "published_on" varchar,
      "workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "_status" "enum_news_status" DEFAULT 'draft'
    );

    CREATE TABLE IF NOT EXISTS "_news_v" (
      "id" serial PRIMARY KEY NOT NULL,
      "parent_id" integer REFERENCES "public"."news"("id") ON DELETE set null,
      "version_headline" varchar,
      "version_slug" varchar,
      "version_summary" varchar,
      "version_source_url" varchar,
      "version_source_name" varchar,
      "version_related_race_id" integer REFERENCES "public"."races"("id") ON DELETE set null,
      "version_published_on" varchar,
      "version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
      "version_updated_at" timestamp(3) with time zone,
      "version_created_at" timestamp(3) with time zone,
      "version__status" "enum__news_v_version_status" DEFAULT 'draft',
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "latest" boolean
    );

    ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "news_id" integer REFERENCES "public"."news"("id") ON DELETE cascade;

    CREATE UNIQUE INDEX IF NOT EXISTS "news_slug_idx" ON "news" USING btree ("slug");
    CREATE INDEX IF NOT EXISTS "news_related_race_idx" ON "news" USING btree ("related_race_id");
    CREATE INDEX IF NOT EXISTS "news_published_on_idx" ON "news" USING btree ("published_on");
    CREATE INDEX IF NOT EXISTS "news_updated_at_idx" ON "news" USING btree ("updated_at");
    CREATE INDEX IF NOT EXISTS "news_created_at_idx" ON "news" USING btree ("created_at");
    CREATE INDEX IF NOT EXISTS "news__status_idx" ON "news" USING btree ("_status");
    CREATE INDEX IF NOT EXISTS "_news_v_parent_idx" ON "_news_v" USING btree ("parent_id");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version_slug_idx" ON "_news_v" USING btree ("version_slug");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version_related_race_idx" ON "_news_v" USING btree ("version_related_race_id");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version_published_on_idx" ON "_news_v" USING btree ("version_published_on");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version_updated_at_idx" ON "_news_v" USING btree ("version_updated_at");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version_created_at_idx" ON "_news_v" USING btree ("version_created_at");
    CREATE INDEX IF NOT EXISTS "_news_v_version_version__status_idx" ON "_news_v" USING btree ("version__status");
    CREATE INDEX IF NOT EXISTS "_news_v_created_at_idx" ON "_news_v" USING btree ("created_at");
    CREATE INDEX IF NOT EXISTS "_news_v_updated_at_idx" ON "_news_v" USING btree ("updated_at");
    CREATE INDEX IF NOT EXISTS "_news_v_latest_idx" ON "_news_v" USING btree ("latest");
    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_news_id_idx" ON "payload_locked_documents_rels" USING btree ("news_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "payload_locked_documents_rels_news_id_idx";
    ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "news_id";
    DROP TABLE IF EXISTS "_news_v" CASCADE;
    DROP TABLE IF EXISTS "news" CASCADE;
    DROP TYPE IF EXISTS "public"."enum__news_v_version_status";
    DROP TYPE IF EXISTS "public"."enum_news_status";
    ALTER TABLE "members" DROP COLUMN IF EXISTS "home_city";
  `)
}
