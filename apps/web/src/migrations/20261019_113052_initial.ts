import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Hand-written: migrate:create emits the trigram GIN indexes from afterSchemaInit but never the extension they need.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`)
  await db.execute(sql`
   CREATE TYPE "public"."enum_staff_role" AS ENUM('admin', 'editor', 'author');
  CREATE TYPE "public"."enum_coaches_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__coaches_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_races_distances_category" AS ENUM('5k', '10k', 'half', 'marathon', 'ultra-50k', 'ultra-50mi', 'ultra-100k', 'ultra-100mi', 'ultra-multiday', 'other');
  CREATE TYPE "public"."enum_races_distances_band" AS ENUM('under-10k', '10k-to-half', 'half-to-marathon', 'marathon-to-60k', '60k-to-100k', 'over-100k');
  CREATE TYPE "public"."enum_races_distances_terrain" AS ENUM('road', 'trail', 'mixed', 'track');
  CREATE TYPE "public"."enum_races_discipline" AS ENUM('road', 'trail', 'mountain', 'skyrunning', 'cross-country', 'track', 'virtual', 'community');
  CREATE TYPE "public"."enum_races_location_kind" AS ENUM('venue', 'virtual');
  CREATE TYPE "public"."enum_races_location_subdivision" AS ENUM('IN-AN', 'IN-AP', 'IN-AR', 'IN-AS', 'IN-BR', 'IN-CH', 'IN-CG', 'IN-DH', 'IN-DL', 'IN-GA', 'IN-GJ', 'IN-HR', 'IN-HP', 'IN-JK', 'IN-JH', 'IN-KA', 'IN-KL', 'IN-LA', 'IN-LD', 'IN-MP', 'IN-MH', 'IN-MN', 'IN-ML', 'IN-MZ', 'IN-NL', 'IN-OD', 'IN-PY', 'IN-PB', 'IN-RJ', 'IN-SK', 'IN-TN', 'IN-TS', 'IN-TR', 'IN-UP', 'IN-UK', 'IN-WB');
  CREATE TYPE "public"."enum_races_status_kind" AS ENUM('scheduled', 'postponed', 'cancelled');
  CREATE TYPE "public"."enum_races_source_kind" AS ENUM('organiser', 'listing-site', 'runner-submission', 'coach-knowledge');
  CREATE TYPE "public"."enum_races_moderation_state" AS ENUM('submitted', 'approved', 'rejected');
  CREATE TABLE "staff_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "staff" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" "enum_staff_role" NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"prefix" varchar DEFAULT '',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "coaches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"slug" varchar,
  	"credentials" varchar,
  	"photo_id" integer,
  	"workflow" jsonb DEFAULT '{"kind":"draft"}'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_coaches_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_coaches_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_name" varchar,
  	"version_slug" varchar,
  	"version_credentials" varchar,
  	"version_photo_id" integer,
  	"version_workflow" jsonb DEFAULT '{"kind":"draft"}'::jsonb,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__coaches_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "races_distances" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"metres" numeric NOT NULL,
  	"category" "enum_races_distances_category",
  	"band" "enum_races_distances_band",
  	"elevation_gain_metres" numeric,
  	"terrain" "enum_races_distances_terrain",
  	"cutoff" numeric
  );
  
  CREATE TABLE "races" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"discipline" "enum_races_discipline" NOT NULL,
  	"dates_start" varchar NOT NULL,
  	"dates_day_count" numeric DEFAULT 1 NOT NULL,
  	"time_zone" varchar DEFAULT 'Asia/Kolkata' NOT NULL,
  	"location_kind" "enum_races_location_kind" DEFAULT 'venue' NOT NULL,
  	"location_venue" varchar,
  	"location_city" varchar,
  	"location_subdivision" "enum_races_location_subdivision",
  	"location_country" varchar DEFAULT 'IN',
  	"official_url" varchar NOT NULL,
  	"registration_url" varchar NOT NULL,
  	"registration_closes_on" varchar,
  	"status_kind" "enum_races_status_kind" DEFAULT 'scheduled' NOT NULL,
  	"status_new_start" varchar,
  	"source_kind" "enum_races_source_kind" NOT NULL,
  	"source_name" varchar,
  	"source_url" varchar,
  	"source_coach_id" integer,
  	"last_verified_on" varchar NOT NULL,
  	"summary" varchar NOT NULL,
  	"moderation_state" "enum_races_moderation_state" DEFAULT 'submitted' NOT NULL,
  	"moderation_decided_by_id" integer,
  	"moderation_decided_at" timestamp(3) with time zone,
  	"moderation_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"staff_id" integer,
  	"media_id" integer,
  	"coaches_id" integer,
  	"races_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"staff_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "coaches" ADD CONSTRAINT "coaches_photo_id_media_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_coaches_v" ADD CONSTRAINT "_coaches_v_parent_id_coaches_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_coaches_v" ADD CONSTRAINT "_coaches_v_version_photo_id_media_id_fk" FOREIGN KEY ("version_photo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "races_distances" ADD CONSTRAINT "races_distances_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "races" ADD CONSTRAINT "races_source_coach_id_coaches_id_fk" FOREIGN KEY ("source_coach_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "races" ADD CONSTRAINT "races_moderation_decided_by_id_staff_id_fk" FOREIGN KEY ("moderation_decided_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_staff_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_coaches_fk" FOREIGN KEY ("coaches_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_races_fk" FOREIGN KEY ("races_id") REFERENCES "public"."races"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_staff_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "staff_sessions_order_idx" ON "staff_sessions" USING btree ("_order");
  CREATE INDEX "staff_sessions_parent_id_idx" ON "staff_sessions" USING btree ("_parent_id");
  CREATE INDEX "staff_updated_at_idx" ON "staff" USING btree ("updated_at");
  CREATE INDEX "staff_created_at_idx" ON "staff" USING btree ("created_at");
  CREATE UNIQUE INDEX "staff_email_idx" ON "staff" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE UNIQUE INDEX "coaches_slug_idx" ON "coaches" USING btree ("slug");
  CREATE INDEX "coaches_photo_idx" ON "coaches" USING btree ("photo_id");
  CREATE INDEX "coaches_updated_at_idx" ON "coaches" USING btree ("updated_at");
  CREATE INDEX "coaches_created_at_idx" ON "coaches" USING btree ("created_at");
  CREATE INDEX "coaches__status_idx" ON "coaches" USING btree ("_status");
  CREATE INDEX "_coaches_v_parent_idx" ON "_coaches_v" USING btree ("parent_id");
  CREATE INDEX "_coaches_v_version_version_slug_idx" ON "_coaches_v" USING btree ("version_slug");
  CREATE INDEX "_coaches_v_version_version_photo_idx" ON "_coaches_v" USING btree ("version_photo_id");
  CREATE INDEX "_coaches_v_version_version_updated_at_idx" ON "_coaches_v" USING btree ("version_updated_at");
  CREATE INDEX "_coaches_v_version_version_created_at_idx" ON "_coaches_v" USING btree ("version_created_at");
  CREATE INDEX "_coaches_v_version_version__status_idx" ON "_coaches_v" USING btree ("version__status");
  CREATE INDEX "_coaches_v_created_at_idx" ON "_coaches_v" USING btree ("created_at");
  CREATE INDEX "_coaches_v_updated_at_idx" ON "_coaches_v" USING btree ("updated_at");
  CREATE INDEX "_coaches_v_latest_idx" ON "_coaches_v" USING btree ("latest");
  CREATE INDEX "races_distances_order_idx" ON "races_distances" USING btree ("_order");
  CREATE INDEX "races_distances_parent_id_idx" ON "races_distances" USING btree ("_parent_id");
  CREATE INDEX "races_distances_band_parent_idx" ON "races_distances" USING btree ("band","_parent_id");
  CREATE UNIQUE INDEX "races_slug_idx" ON "races" USING btree ("slug");
  CREATE INDEX "races_discipline_idx" ON "races" USING btree ("discipline");
  CREATE INDEX "races_dates_dates_start_idx" ON "races" USING btree ("dates_start");
  CREATE INDEX "races_location_location_subdivision_idx" ON "races" USING btree ("location_subdivision");
  CREATE INDEX "races_source_source_coach_idx" ON "races" USING btree ("source_coach_id");
  CREATE INDEX "races_moderation_moderation_decided_by_idx" ON "races" USING btree ("moderation_decided_by_id");
  CREATE INDEX "races_updated_at_idx" ON "races" USING btree ("updated_at");
  CREATE INDEX "races_created_at_idx" ON "races" USING btree ("created_at");
  CREATE INDEX "races_approved_start_idx" ON "races" USING btree ("dates_start") WHERE moderation_state = 'approved';
  CREATE INDEX "races_name_trgm_idx" ON "races" USING gin ("name" gin_trgm_ops);
  CREATE INDEX "races_location_city_trgm_idx" ON "races" USING gin ("location_city" gin_trgm_ops);
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_staff_id_idx" ON "payload_locked_documents_rels" USING btree ("staff_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_coaches_id_idx" ON "payload_locked_documents_rels" USING btree ("coaches_id");
  CREATE INDEX "payload_locked_documents_rels_races_id_idx" ON "payload_locked_documents_rels" USING btree ("races_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_staff_id_idx" ON "payload_preferences_rels" USING btree ("staff_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "staff_sessions" CASCADE;
  DROP TABLE "staff" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "coaches" CASCADE;
  DROP TABLE "_coaches_v" CASCADE;
  DROP TABLE "races_distances" CASCADE;
  DROP TABLE "races" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_staff_role";
  DROP TYPE "public"."enum_coaches_status";
  DROP TYPE "public"."enum__coaches_v_version_status";
  DROP TYPE "public"."enum_races_distances_category";
  DROP TYPE "public"."enum_races_distances_band";
  DROP TYPE "public"."enum_races_distances_terrain";
  DROP TYPE "public"."enum_races_discipline";
  DROP TYPE "public"."enum_races_location_kind";
  DROP TYPE "public"."enum_races_location_subdivision";
  DROP TYPE "public"."enum_races_status_kind";
  DROP TYPE "public"."enum_races_source_kind";
  DROP TYPE "public"."enum_races_moderation_state";`)
}
