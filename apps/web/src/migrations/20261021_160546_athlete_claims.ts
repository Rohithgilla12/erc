import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_athletes_visibility_mileage" AS ENUM('hidden', 'public');
  CREATE TYPE "public"."enum_athletes_leaderboards" AS ENUM('included', 'withheld');
  CREATE TYPE "public"."enum_claims_moderation_state" AS ENUM('submitted', 'approved', 'rejected');
  CREATE TYPE "public"."enum_profile_changes_field" AS ENUM('name', 'bio', 'photo');
  CREATE TYPE "public"."enum_profile_changes_moderation_state" AS ENUM('submitted', 'approved', 'rejected');
  CREATE TABLE "claims" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"member_id" integer NOT NULL,
  	"athlete_id" integer NOT NULL,
  	"note" varchar NOT NULL,
  	"moderation_state" "enum_claims_moderation_state" DEFAULT 'submitted' NOT NULL,
  	"moderation_submitter_name" varchar,
  	"moderation_submitter_email" varchar,
  	"moderation_submitted_at" timestamp(3) with time zone,
  	"moderation_decided_by_id" integer,
  	"moderation_decided_at" timestamp(3) with time zone,
  	"moderation_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "profile_changes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"member_id" integer NOT NULL,
  	"athlete_id" integer NOT NULL,
  	"field" "enum_profile_changes_field" NOT NULL,
  	"text" varchar,
  	"photo_id" integer,
  	"moderation_state" "enum_profile_changes_moderation_state" DEFAULT 'submitted' NOT NULL,
  	"moderation_submitter_name" varchar,
  	"moderation_submitter_email" varchar,
  	"moderation_submitted_at" timestamp(3) with time zone,
  	"moderation_decided_by_id" integer,
  	"moderation_decided_at" timestamp(3) with time zone,
  	"moderation_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "athletes" ADD COLUMN "member_id" integer;
  ALTER TABLE "athletes" ADD COLUMN "birth_year" numeric;
  ALTER TABLE "athletes" ADD COLUMN "visibility_mileage" "enum_athletes_visibility_mileage" DEFAULT 'hidden' NOT NULL;
  ALTER TABLE "athletes" ADD COLUMN "leaderboards" "enum_athletes_leaderboards" DEFAULT 'included' NOT NULL;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "claims_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "profile_changes_id" integer;
  ALTER TABLE "claims" ADD CONSTRAINT "claims_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "claims" ADD CONSTRAINT "claims_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "claims" ADD CONSTRAINT "claims_moderation_decided_by_id_staff_id_fk" FOREIGN KEY ("moderation_decided_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "profile_changes" ADD CONSTRAINT "profile_changes_moderation_decided_by_id_staff_id_fk" FOREIGN KEY ("moderation_decided_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "claims_member_idx" ON "claims" USING btree ("member_id");
  CREATE INDEX "claims_athlete_idx" ON "claims" USING btree ("athlete_id");
  CREATE INDEX "claims_moderation_moderation_decided_by_idx" ON "claims" USING btree ("moderation_decided_by_id");
  CREATE INDEX "claims_updated_at_idx" ON "claims" USING btree ("updated_at");
  CREATE INDEX "claims_created_at_idx" ON "claims" USING btree ("created_at");
  CREATE UNIQUE INDEX "claims_open_athlete_idx" ON "claims" USING btree ("athlete_id") WHERE moderation_state = 'submitted';
  CREATE UNIQUE INDEX "claims_open_member_idx" ON "claims" USING btree ("member_id") WHERE moderation_state = 'submitted';
  CREATE INDEX "profile_changes_member_idx" ON "profile_changes" USING btree ("member_id");
  CREATE INDEX "profile_changes_athlete_idx" ON "profile_changes" USING btree ("athlete_id");
  CREATE INDEX "profile_changes_photo_idx" ON "profile_changes" USING btree ("photo_id");
  CREATE INDEX "profile_changes_moderation_moderation_decided_by_idx" ON "profile_changes" USING btree ("moderation_decided_by_id");
  CREATE INDEX "profile_changes_updated_at_idx" ON "profile_changes" USING btree ("updated_at");
  CREATE INDEX "profile_changes_created_at_idx" ON "profile_changes" USING btree ("created_at");
  CREATE UNIQUE INDEX "profile_changes_open_field_idx" ON "profile_changes" USING btree ("athlete_id","field") WHERE moderation_state = 'submitted';
  ALTER TABLE "athletes" ADD CONSTRAINT "athletes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_claims_fk" FOREIGN KEY ("claims_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_profile_changes_fk" FOREIGN KEY ("profile_changes_id") REFERENCES "public"."profile_changes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "athletes_member_idx" ON "athletes" USING btree ("member_id");
  CREATE INDEX "payload_locked_documents_rels_claims_id_idx" ON "payload_locked_documents_rels" USING btree ("claims_id");
  CREATE INDEX "payload_locked_documents_rels_profile_changes_id_idx" ON "payload_locked_documents_rels" USING btree ("profile_changes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // DROP TABLE ... CASCADE already removes the rels constraints, so dropping them again must tolerate their absence.
  await db.execute(sql`
   ALTER TABLE "claims" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "profile_changes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "claims" CASCADE;
  DROP TABLE "profile_changes" CASCADE;
  ALTER TABLE "athletes" DROP CONSTRAINT "athletes_member_id_members_id_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_claims_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_profile_changes_fk";
  
  DROP INDEX "athletes_member_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_claims_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_profile_changes_id_idx";
  ALTER TABLE "athletes" DROP COLUMN "member_id";
  ALTER TABLE "athletes" DROP COLUMN "birth_year";
  ALTER TABLE "athletes" DROP COLUMN "visibility_mileage";
  ALTER TABLE "athletes" DROP COLUMN "leaderboards";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "claims_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "profile_changes_id";
  DROP TYPE "public"."enum_athletes_visibility_mileage";
  DROP TYPE "public"."enum_athletes_leaderboards";
  DROP TYPE "public"."enum_claims_moderation_state";
  DROP TYPE "public"."enum_profile_changes_field";
  DROP TYPE "public"."enum_profile_changes_moderation_state";`)
}
