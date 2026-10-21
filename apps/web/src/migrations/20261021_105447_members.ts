import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_members_status" AS ENUM('active', 'suspended');
  CREATE TABLE "members" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"status" "enum_members_status" DEFAULT 'active' NOT NULL,
  	"age_declared_at" timestamp(3) with time zone NOT NULL,
  	"last_sign_in_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "members_id" integer;
  CREATE UNIQUE INDEX "members_email_idx" ON "members" USING btree ("email");
  CREATE INDEX "members_status_idx" ON "members" USING btree ("status");
  CREATE INDEX "members_updated_at_idx" ON "members" USING btree ("updated_at");
  CREATE INDEX "members_created_at_idx" ON "members" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_members_fk" FOREIGN KEY ("members_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_members_id_idx" ON "payload_locked_documents_rels" USING btree ("members_id");`)

  // App tables, written at volume by sign-in and by members, so they are plain SQL read by src/members, not collections.
  await db.execute(sql`
  CREATE TABLE "member_sessions" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"member_id" integer NOT NULL REFERENCES "members"("id") ON DELETE cascade,
  	"token_hash" varchar(64) NOT NULL UNIQUE,
  	"carrier" varchar NOT NULL CHECK ("carrier" IN ('cookie', 'bearer')),
  	"label" varchar(40) NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"last_seen_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  CREATE INDEX "member_sessions_member_id_idx" ON "member_sessions" USING btree ("member_id");
  CREATE INDEX "member_sessions_expires_at_idx" ON "member_sessions" USING btree ("expires_at");

  CREATE TABLE "sign_in_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"code_hash" varchar NOT NULL,
  	"sender_key" varchar NOT NULL,
  	"sent_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"tries" integer DEFAULT 0 NOT NULL,
  	"closed_at" timestamp(3) with time zone
  );
  CREATE INDEX "sign_in_codes_email_sent_at_idx" ON "sign_in_codes" USING btree ("email", "sent_at");
  CREATE INDEX "sign_in_codes_sender_key_sent_at_idx" ON "sign_in_codes" USING btree ("sender_key", "sent_at");
  CREATE INDEX "sign_in_codes_sent_at_idx" ON "sign_in_codes" USING btree ("sent_at");

  CREATE TABLE "activities" (
  	"member_id" integer NOT NULL REFERENCES "members"("id") ON DELETE cascade,
  	"source" varchar NOT NULL CHECK ("source" IN ('manual', 'file')),
  	"ref" varchar NOT NULL,
  	"on_date" date NOT NULL,
  	"metres" integer NOT NULL CHECK ("metres" > 0),
  	"moving_s" integer NOT NULL CHECK ("moving_s" > 0),
  	"logged_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	PRIMARY KEY ("member_id", "source", "ref")
  );
  CREATE INDEX "activities_member_id_on_date_idx" ON "activities" USING btree ("member_id", "on_date", "logged_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP TABLE "activities";
  DROP TABLE "sign_in_codes";
  DROP TABLE "member_sessions";`)
  // DROP TABLE ... CASCADE already removes the rels constraint, so dropping it again must tolerate its absence.
  await db.execute(sql`
   ALTER TABLE "members" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "members" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_members_fk";

  DROP INDEX IF EXISTS "payload_locked_documents_rels_members_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "members_id";
  DROP TYPE "public"."enum_members_status";`)
}
