import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_resources_category" AS ENUM('plan-pdf', 'checklist', 'guide', 'spreadsheet');
  CREATE TYPE "public"."enum_resources_access_kind" AS ENUM('free');
  CREATE TYPE "public"."enum_resources_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__resources_v_version_category" AS ENUM('plan-pdf', 'checklist', 'guide', 'spreadsheet');
  CREATE TYPE "public"."enum__resources_v_version_access_kind" AS ENUM('free');
  CREATE TYPE "public"."enum__resources_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_training_plans_weeks_sessions_day" AS ENUM('1', '2', '3', '4', '5', '6', '7');
  CREATE TYPE "public"."enum_training_plans_weeks_sessions_intensity" AS ENUM('easy', 'steady', 'tempo', 'intervals', 'long', 'strength', 'rest');
  CREATE TYPE "public"."enum_training_plans_weeks_sessions_target_kind" AS ENUM('distance', 'duration', 'none');
  CREATE TYPE "public"."enum_training_plans_goal" AS ENUM('5k', '10k', 'half', 'marathon', 'ultra-50k', 'ultra-50mi', 'ultra-100k', 'ultra-100mi', 'ultra-multiday', 'other');
  CREATE TYPE "public"."enum_training_plans_level" AS ENUM('beginner', 'intermediate', 'advanced');
  CREATE TYPE "public"."enum_training_plans_access_kind" AS ENUM('free');
  CREATE TYPE "public"."enum_training_plans_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__training_plans_v_version_weeks_sessions_day" AS ENUM('1', '2', '3', '4', '5', '6', '7');
  CREATE TYPE "public"."enum__training_plans_v_version_weeks_sessions_intensity" AS ENUM('easy', 'steady', 'tempo', 'intervals', 'long', 'strength', 'rest');
  CREATE TYPE "public"."enum__training_plans_v_version_weeks_sessions_target_kind" AS ENUM('distance', 'duration', 'none');
  CREATE TYPE "public"."enum__training_plans_v_version_goal" AS ENUM('5k', '10k', 'half', 'marathon', 'ultra-50k', 'ultra-50mi', 'ultra-100k', 'ultra-100mi', 'ultra-multiday', 'other');
  CREATE TYPE "public"."enum__training_plans_v_version_level" AS ENUM('beginner', 'intermediate', 'advanced');
  CREATE TYPE "public"."enum__training_plans_v_version_access_kind" AS ENUM('free');
  CREATE TYPE "public"."enum__training_plans_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "resources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"description" varchar,
  	"category" "enum_resources_category",
  	"access_kind" "enum_resources_access_kind" DEFAULT 'free',
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"prefix" varchar DEFAULT '',
  	"_objectkey" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_resources_status" DEFAULT 'draft',
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
  
  CREATE TABLE "_resources_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_description" varchar,
  	"version_category" "enum__resources_v_version_category",
  	"version_access_kind" "enum__resources_v_version_access_kind" DEFAULT 'free',
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"version_prefix" varchar DEFAULT '',
  	"version__objectkey" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__resources_v_version_status" DEFAULT 'draft',
  	"version_url" varchar,
  	"version_thumbnail_u_r_l" varchar,
  	"version_filename" varchar,
  	"version_mime_type" varchar,
  	"version_filesize" numeric,
  	"version_width" numeric,
  	"version_height" numeric,
  	"version_focal_x" numeric,
  	"version_focal_y" numeric,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "training_plans_weeks_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"day" "enum_training_plans_weeks_sessions_day",
  	"intensity" "enum_training_plans_weeks_sessions_intensity",
  	"title" varchar,
  	"target_kind" "enum_training_plans_weeks_sessions_target_kind" DEFAULT 'duration',
  	"target_metres" numeric,
  	"target_seconds" numeric,
  	"notes" varchar
  );
  
  CREATE TABLE "training_plans_weeks" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"focus" varchar
  );
  
  CREATE TABLE "training_plans" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"goal" "enum_training_plans_goal",
  	"level" "enum_training_plans_level",
  	"prerequisites" varchar,
  	"audience" varchar,
  	"overview" jsonb,
  	"strength" jsonb,
  	"recovery" jsonb,
  	"access_kind" "enum_training_plans_access_kind" DEFAULT 'free',
  	"pdf_id" integer,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_training_plans_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "training_plans_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"coaches_id" integer
  );
  
  CREATE TABLE "_training_plans_v_version_weeks_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"day" "enum__training_plans_v_version_weeks_sessions_day",
  	"intensity" "enum__training_plans_v_version_weeks_sessions_intensity",
  	"title" varchar,
  	"target_kind" "enum__training_plans_v_version_weeks_sessions_target_kind" DEFAULT 'duration',
  	"target_metres" numeric,
  	"target_seconds" numeric,
  	"notes" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_training_plans_v_version_weeks" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"focus" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_training_plans_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_goal" "enum__training_plans_v_version_goal",
  	"version_level" "enum__training_plans_v_version_level",
  	"version_prerequisites" varchar,
  	"version_audience" varchar,
  	"version_overview" jsonb,
  	"version_strength" jsonb,
  	"version_recovery" jsonb,
  	"version_access_kind" "enum__training_plans_v_version_access_kind" DEFAULT 'free',
  	"version_pdf_id" integer,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__training_plans_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_training_plans_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"coaches_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "resources_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "training_plans_id" integer;
  ALTER TABLE "resources" ADD CONSTRAINT "resources_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_resources_v" ADD CONSTRAINT "_resources_v_parent_id_resources_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_resources_v" ADD CONSTRAINT "_resources_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "training_plans_weeks_sessions" ADD CONSTRAINT "training_plans_weeks_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."training_plans_weeks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "training_plans_weeks" ADD CONSTRAINT "training_plans_weeks_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_pdf_id_resources_id_fk" FOREIGN KEY ("pdf_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "training_plans_rels" ADD CONSTRAINT "training_plans_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "training_plans_rels" ADD CONSTRAINT "training_plans_rels_coaches_fk" FOREIGN KEY ("coaches_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_training_plans_v_version_weeks_sessions" ADD CONSTRAINT "_training_plans_v_version_weeks_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_training_plans_v_version_weeks"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_training_plans_v_version_weeks" ADD CONSTRAINT "_training_plans_v_version_weeks_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_training_plans_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_training_plans_v" ADD CONSTRAINT "_training_plans_v_parent_id_training_plans_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."training_plans"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_training_plans_v" ADD CONSTRAINT "_training_plans_v_version_pdf_id_resources_id_fk" FOREIGN KEY ("version_pdf_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_training_plans_v" ADD CONSTRAINT "_training_plans_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_training_plans_v_rels" ADD CONSTRAINT "_training_plans_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_training_plans_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_training_plans_v_rels" ADD CONSTRAINT "_training_plans_v_rels_coaches_fk" FOREIGN KEY ("coaches_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "resources_slug_idx" ON "resources" USING btree ("slug");
  CREATE INDEX "resources_seo_seo_image_idx" ON "resources" USING btree ("seo_image_id");
  CREATE INDEX "resources_updated_at_idx" ON "resources" USING btree ("updated_at");
  CREATE INDEX "resources_created_at_idx" ON "resources" USING btree ("created_at");
  CREATE INDEX "resources__status_idx" ON "resources" USING btree ("_status");
  CREATE UNIQUE INDEX "resources_filename_idx" ON "resources" USING btree ("filename");
  CREATE INDEX "_resources_v_parent_idx" ON "_resources_v" USING btree ("parent_id");
  CREATE INDEX "_resources_v_version_version_slug_idx" ON "_resources_v" USING btree ("version_slug");
  CREATE INDEX "_resources_v_version_seo_version_seo_image_idx" ON "_resources_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_resources_v_version_version_updated_at_idx" ON "_resources_v" USING btree ("version_updated_at");
  CREATE INDEX "_resources_v_version_version_created_at_idx" ON "_resources_v" USING btree ("version_created_at");
  CREATE INDEX "_resources_v_version_version__status_idx" ON "_resources_v" USING btree ("version__status");
  CREATE INDEX "_resources_v_version_version_filename_idx" ON "_resources_v" USING btree ("version_filename");
  CREATE INDEX "_resources_v_created_at_idx" ON "_resources_v" USING btree ("created_at");
  CREATE INDEX "_resources_v_updated_at_idx" ON "_resources_v" USING btree ("updated_at");
  CREATE INDEX "_resources_v_latest_idx" ON "_resources_v" USING btree ("latest");
  CREATE INDEX "training_plans_weeks_sessions_order_idx" ON "training_plans_weeks_sessions" USING btree ("_order");
  CREATE INDEX "training_plans_weeks_sessions_parent_id_idx" ON "training_plans_weeks_sessions" USING btree ("_parent_id");
  CREATE INDEX "training_plans_weeks_order_idx" ON "training_plans_weeks" USING btree ("_order");
  CREATE INDEX "training_plans_weeks_parent_id_idx" ON "training_plans_weeks" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "training_plans_slug_idx" ON "training_plans" USING btree ("slug");
  CREATE INDEX "training_plans_goal_idx" ON "training_plans" USING btree ("goal");
  CREATE INDEX "training_plans_level_idx" ON "training_plans" USING btree ("level");
  CREATE INDEX "training_plans_pdf_idx" ON "training_plans" USING btree ("pdf_id");
  CREATE INDEX "training_plans_seo_seo_image_idx" ON "training_plans" USING btree ("seo_image_id");
  CREATE INDEX "training_plans_updated_at_idx" ON "training_plans" USING btree ("updated_at");
  CREATE INDEX "training_plans_created_at_idx" ON "training_plans" USING btree ("created_at");
  CREATE INDEX "training_plans__status_idx" ON "training_plans" USING btree ("_status");
  CREATE INDEX "training_plans_rels_order_idx" ON "training_plans_rels" USING btree ("order");
  CREATE INDEX "training_plans_rels_parent_idx" ON "training_plans_rels" USING btree ("parent_id");
  CREATE INDEX "training_plans_rels_path_idx" ON "training_plans_rels" USING btree ("path");
  CREATE INDEX "training_plans_rels_coaches_id_idx" ON "training_plans_rels" USING btree ("coaches_id");
  CREATE INDEX "_training_plans_v_version_weeks_sessions_order_idx" ON "_training_plans_v_version_weeks_sessions" USING btree ("_order");
  CREATE INDEX "_training_plans_v_version_weeks_sessions_parent_id_idx" ON "_training_plans_v_version_weeks_sessions" USING btree ("_parent_id");
  CREATE INDEX "_training_plans_v_version_weeks_order_idx" ON "_training_plans_v_version_weeks" USING btree ("_order");
  CREATE INDEX "_training_plans_v_version_weeks_parent_id_idx" ON "_training_plans_v_version_weeks" USING btree ("_parent_id");
  CREATE INDEX "_training_plans_v_parent_idx" ON "_training_plans_v" USING btree ("parent_id");
  CREATE INDEX "_training_plans_v_version_version_slug_idx" ON "_training_plans_v" USING btree ("version_slug");
  CREATE INDEX "_training_plans_v_version_version_goal_idx" ON "_training_plans_v" USING btree ("version_goal");
  CREATE INDEX "_training_plans_v_version_version_level_idx" ON "_training_plans_v" USING btree ("version_level");
  CREATE INDEX "_training_plans_v_version_version_pdf_idx" ON "_training_plans_v" USING btree ("version_pdf_id");
  CREATE INDEX "_training_plans_v_version_seo_version_seo_image_idx" ON "_training_plans_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_training_plans_v_version_version_updated_at_idx" ON "_training_plans_v" USING btree ("version_updated_at");
  CREATE INDEX "_training_plans_v_version_version_created_at_idx" ON "_training_plans_v" USING btree ("version_created_at");
  CREATE INDEX "_training_plans_v_version_version__status_idx" ON "_training_plans_v" USING btree ("version__status");
  CREATE INDEX "_training_plans_v_created_at_idx" ON "_training_plans_v" USING btree ("created_at");
  CREATE INDEX "_training_plans_v_updated_at_idx" ON "_training_plans_v" USING btree ("updated_at");
  CREATE INDEX "_training_plans_v_latest_idx" ON "_training_plans_v" USING btree ("latest");
  CREATE INDEX "_training_plans_v_rels_order_idx" ON "_training_plans_v_rels" USING btree ("order");
  CREATE INDEX "_training_plans_v_rels_parent_idx" ON "_training_plans_v_rels" USING btree ("parent_id");
  CREATE INDEX "_training_plans_v_rels_path_idx" ON "_training_plans_v_rels" USING btree ("path");
  CREATE INDEX "_training_plans_v_rels_coaches_id_idx" ON "_training_plans_v_rels" USING btree ("coaches_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_resources_fk" FOREIGN KEY ("resources_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_training_plans_fk" FOREIGN KEY ("training_plans_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_resources_id_idx" ON "payload_locked_documents_rels" USING btree ("resources_id");
  CREATE INDEX "payload_locked_documents_rels_training_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("training_plans_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "resources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_resources_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "training_plans_weeks_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "training_plans_weeks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "training_plans" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "training_plans_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_training_plans_v_version_weeks_sessions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_training_plans_v_version_weeks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_training_plans_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_training_plans_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "resources" CASCADE;
  DROP TABLE "_resources_v" CASCADE;
  DROP TABLE "training_plans_weeks_sessions" CASCADE;
  DROP TABLE "training_plans_weeks" CASCADE;
  DROP TABLE "training_plans" CASCADE;
  DROP TABLE "training_plans_rels" CASCADE;
  DROP TABLE "_training_plans_v_version_weeks_sessions" CASCADE;
  DROP TABLE "_training_plans_v_version_weeks" CASCADE;
  DROP TABLE "_training_plans_v" CASCADE;
  DROP TABLE "_training_plans_v_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_resources_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_training_plans_fk";
  
  DROP INDEX "payload_locked_documents_rels_resources_id_idx";
  DROP INDEX "payload_locked_documents_rels_training_plans_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "resources_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "training_plans_id";
  DROP TYPE "public"."enum_resources_category";
  DROP TYPE "public"."enum_resources_access_kind";
  DROP TYPE "public"."enum_resources_status";
  DROP TYPE "public"."enum__resources_v_version_category";
  DROP TYPE "public"."enum__resources_v_version_access_kind";
  DROP TYPE "public"."enum__resources_v_version_status";
  DROP TYPE "public"."enum_training_plans_weeks_sessions_day";
  DROP TYPE "public"."enum_training_plans_weeks_sessions_intensity";
  DROP TYPE "public"."enum_training_plans_weeks_sessions_target_kind";
  DROP TYPE "public"."enum_training_plans_goal";
  DROP TYPE "public"."enum_training_plans_level";
  DROP TYPE "public"."enum_training_plans_access_kind";
  DROP TYPE "public"."enum_training_plans_status";
  DROP TYPE "public"."enum__training_plans_v_version_weeks_sessions_day";
  DROP TYPE "public"."enum__training_plans_v_version_weeks_sessions_intensity";
  DROP TYPE "public"."enum__training_plans_v_version_weeks_sessions_target_kind";
  DROP TYPE "public"."enum__training_plans_v_version_goal";
  DROP TYPE "public"."enum__training_plans_v_version_level";
  DROP TYPE "public"."enum__training_plans_v_version_access_kind";
  DROP TYPE "public"."enum__training_plans_v_version_status";`)
}
