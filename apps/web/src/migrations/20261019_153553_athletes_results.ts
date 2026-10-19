import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_athletes_home_subdivision" AS ENUM('IN-AN', 'IN-AP', 'IN-AR', 'IN-AS', 'IN-BR', 'IN-CH', 'IN-CG', 'IN-DH', 'IN-DL', 'IN-GA', 'IN-GJ', 'IN-HR', 'IN-HP', 'IN-JK', 'IN-JH', 'IN-KA', 'IN-KL', 'IN-LA', 'IN-LD', 'IN-MP', 'IN-MH', 'IN-MN', 'IN-ML', 'IN-MZ', 'IN-NL', 'IN-OD', 'IN-PY', 'IN-PB', 'IN-RJ', 'IN-SK', 'IN-TN', 'IN-TS', 'IN-TR', 'IN-UP', 'IN-UK', 'IN-WB');
  CREATE TYPE "public"."enum_athletes_visibility_profile" AS ENUM('hidden', 'public');
  CREATE TYPE "public"."enum_athletes_visibility_results" AS ENUM('hidden', 'public');
  CREATE TYPE "public"."enum_athletes_moderation_state" AS ENUM('submitted', 'approved', 'rejected');
  CREATE TYPE "public"."enum_results_category" AS ENUM('5k', '10k', 'half', 'marathon', 'ultra-50k', 'ultra-50mi', 'ultra-100k', 'ultra-100mi', 'ultra-multiday', 'other');
  CREATE TYPE "public"."enum_results_provenance_kind" AS ENUM('official', 'self_reported');
  CREATE TYPE "public"."enum_results_moderation_state" AS ENUM('submitted', 'approved', 'rejected');
  CREATE TABLE "athletes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"photo_id" integer,
  	"bio" varchar,
  	"home_city" varchar,
  	"home_subdivision" "enum_athletes_home_subdivision" NOT NULL,
  	"running_since" numeric,
  	"visibility_profile" "enum_athletes_visibility_profile" DEFAULT 'hidden' NOT NULL,
  	"visibility_results" "enum_athletes_visibility_results" DEFAULT 'hidden' NOT NULL,
  	"moderation_state" "enum_athletes_moderation_state" DEFAULT 'submitted' NOT NULL,
  	"moderation_submitter_name" varchar,
  	"moderation_submitter_email" varchar,
  	"moderation_submitted_at" timestamp(3) with time zone,
  	"moderation_decided_by_id" integer,
  	"moderation_decided_at" timestamp(3) with time zone,
  	"moderation_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "results" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"athlete_id" integer NOT NULL,
  	"race_id" integer,
  	"event_name" varchar NOT NULL,
  	"date" varchar NOT NULL,
  	"distance" numeric NOT NULL,
  	"time" numeric NOT NULL,
  	"category" "enum_results_category",
  	"provenance_kind" "enum_results_provenance_kind" DEFAULT 'official' NOT NULL,
  	"provenance_timing_url" varchar,
  	"provenance_evidence_url" varchar,
  	"moderation_state" "enum_results_moderation_state" DEFAULT 'submitted' NOT NULL,
  	"moderation_submitter_name" varchar,
  	"moderation_submitter_email" varchar,
  	"moderation_submitted_at" timestamp(3) with time zone,
  	"moderation_decided_by_id" integer,
  	"moderation_decided_at" timestamp(3) with time zone,
  	"moderation_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "athletes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "results_id" integer;
  ALTER TABLE "athletes" ADD CONSTRAINT "athletes_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "athletes" ADD CONSTRAINT "athletes_moderation_decided_by_id_staff_id_fk" FOREIGN KEY ("moderation_decided_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "results" ADD CONSTRAINT "results_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "results" ADD CONSTRAINT "results_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "results" ADD CONSTRAINT "results_moderation_decided_by_id_staff_id_fk" FOREIGN KEY ("moderation_decided_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "athletes_slug_idx" ON "athletes" USING btree ("slug");
  CREATE INDEX "athletes_photo_idx" ON "athletes" USING btree ("photo_id");
  CREATE INDEX "athletes_home_home_subdivision_idx" ON "athletes" USING btree ("home_subdivision");
  CREATE INDEX "athletes_moderation_moderation_decided_by_idx" ON "athletes" USING btree ("moderation_decided_by_id");
  CREATE INDEX "athletes_updated_at_idx" ON "athletes" USING btree ("updated_at");
  CREATE INDEX "athletes_created_at_idx" ON "athletes" USING btree ("created_at");
  CREATE INDEX "results_athlete_idx" ON "results" USING btree ("athlete_id");
  CREATE INDEX "results_race_idx" ON "results" USING btree ("race_id");
  CREATE INDEX "results_moderation_moderation_decided_by_idx" ON "results" USING btree ("moderation_decided_by_id");
  CREATE INDEX "results_updated_at_idx" ON "results" USING btree ("updated_at");
  CREATE INDEX "results_created_at_idx" ON "results" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_athletes_fk" FOREIGN KEY ("athletes_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_results_fk" FOREIGN KEY ("results_id") REFERENCES "public"."results"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_athletes_id_idx" ON "payload_locked_documents_rels" USING btree ("athletes_id");
  CREATE INDEX "payload_locked_documents_rels_results_id_idx" ON "payload_locked_documents_rels" USING btree ("results_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "athletes" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "results" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "athletes" CASCADE;
  DROP TABLE "results" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_athletes_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_results_fk";
  
  DROP INDEX "payload_locked_documents_rels_athletes_id_idx";
  DROP INDEX "payload_locked_documents_rels_results_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "athletes_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "results_id";
  DROP TYPE "public"."enum_athletes_home_subdivision";
  DROP TYPE "public"."enum_athletes_visibility_profile";
  DROP TYPE "public"."enum_athletes_visibility_results";
  DROP TYPE "public"."enum_athletes_moderation_state";
  DROP TYPE "public"."enum_results_category";
  DROP TYPE "public"."enum_results_provenance_kind";
  DROP TYPE "public"."enum_results_moderation_state";`)
}
