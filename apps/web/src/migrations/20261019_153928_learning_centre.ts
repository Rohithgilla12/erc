import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_topics_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__topics_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_posts_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__posts_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_videos_category" AS ENUM('technique', 'coach-explainers', 'strength', 'race-preparation', 'group-sessions', 'runner-stories');
  CREATE TYPE "public"."enum_videos_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__videos_v_version_category" AS ENUM('technique', 'coach-explainers', 'strength', 'race-preparation', 'group-sessions', 'runner-stories');
  CREATE TYPE "public"."enum__videos_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "topics" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"description" varchar,
  	"order" numeric DEFAULT 0,
  	"workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_topics_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_topics_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_description" varchar,
  	"version_order" numeric DEFAULT 0,
  	"version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__topics_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "posts_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar
  );
  
  CREATE TABLE "posts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"excerpt" varchar,
  	"cover_id" integer,
  	"body" jsonb,
  	"published_at" timestamp(3) with time zone,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_posts_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "posts_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"topics_id" integer,
  	"coaches_id" integer,
  	"posts_id" integer,
  	"videos_id" integer
  );
  
  CREATE TABLE "_posts_v_version_references" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"url" varchar,
  	"publisher" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "_posts_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_excerpt" varchar,
  	"version_cover_id" integer,
  	"version_body" jsonb,
  	"version_published_at" timestamp(3) with time zone,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__posts_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_posts_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"topics_id" integer,
  	"coaches_id" integer,
  	"posts_id" integer,
  	"videos_id" integer
  );
  
  CREATE TABLE "videos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"slug" varchar,
  	"youtube_id" varchar,
  	"duration" varchar,
  	"category" "enum_videos_category",
  	"description" jsonb,
  	"transcript" jsonb,
  	"published_at" timestamp(3) with time zone,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_image_id" integer,
  	"seo_noindex" boolean DEFAULT false,
  	"workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_videos_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "videos_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"topics_id" integer,
  	"posts_id" integer
  );
  
  CREATE TABLE "_videos_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_slug" varchar,
  	"version_youtube_id" varchar,
  	"version_duration" varchar,
  	"version_category" "enum__videos_v_version_category",
  	"version_description" jsonb,
  	"version_transcript" jsonb,
  	"version_published_at" timestamp(3) with time zone,
  	"version_seo_title" varchar,
  	"version_seo_description" varchar,
  	"version_seo_image_id" integer,
  	"version_seo_noindex" boolean DEFAULT false,
  	"version_workflow" jsonb DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__videos_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_videos_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"topics_id" integer,
  	"posts_id" integer
  );
  
  ALTER TABLE "coaches" ADD COLUMN "bio" jsonb;
  ALTER TABLE "_coaches_v" ADD COLUMN "version_bio" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "topics_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "posts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "videos_id" integer;
  ALTER TABLE "_topics_v" ADD CONSTRAINT "_topics_v_parent_id_topics_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "posts_references" ADD CONSTRAINT "posts_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_id_media_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "posts" ADD CONSTRAINT "posts_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_topics_fk" FOREIGN KEY ("topics_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_coaches_fk" FOREIGN KEY ("coaches_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "posts_rels" ADD CONSTRAINT "posts_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_version_references" ADD CONSTRAINT "_posts_v_version_references_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_parent_id_posts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_version_cover_id_media_id_fk" FOREIGN KEY ("version_cover_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v" ADD CONSTRAINT "_posts_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_posts_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_topics_fk" FOREIGN KEY ("topics_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_coaches_fk" FOREIGN KEY ("coaches_id") REFERENCES "public"."coaches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_posts_v_rels" ADD CONSTRAINT "_posts_v_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_seo_image_id_media_id_fk" FOREIGN KEY ("seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_topics_fk" FOREIGN KEY ("topics_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "videos_rels" ADD CONSTRAINT "videos_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_videos_v" ADD CONSTRAINT "_videos_v_parent_id_videos_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_videos_v" ADD CONSTRAINT "_videos_v_version_seo_image_id_media_id_fk" FOREIGN KEY ("version_seo_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_videos_v_rels" ADD CONSTRAINT "_videos_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_videos_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_videos_v_rels" ADD CONSTRAINT "_videos_v_rels_topics_fk" FOREIGN KEY ("topics_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_videos_v_rels" ADD CONSTRAINT "_videos_v_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "topics_slug_idx" ON "topics" USING btree ("slug");
  CREATE INDEX "topics_updated_at_idx" ON "topics" USING btree ("updated_at");
  CREATE INDEX "topics_created_at_idx" ON "topics" USING btree ("created_at");
  CREATE INDEX "topics__status_idx" ON "topics" USING btree ("_status");
  CREATE INDEX "_topics_v_parent_idx" ON "_topics_v" USING btree ("parent_id");
  CREATE INDEX "_topics_v_version_version_slug_idx" ON "_topics_v" USING btree ("version_slug");
  CREATE INDEX "_topics_v_version_version_updated_at_idx" ON "_topics_v" USING btree ("version_updated_at");
  CREATE INDEX "_topics_v_version_version_created_at_idx" ON "_topics_v" USING btree ("version_created_at");
  CREATE INDEX "_topics_v_version_version__status_idx" ON "_topics_v" USING btree ("version__status");
  CREATE INDEX "_topics_v_created_at_idx" ON "_topics_v" USING btree ("created_at");
  CREATE INDEX "_topics_v_updated_at_idx" ON "_topics_v" USING btree ("updated_at");
  CREATE INDEX "_topics_v_latest_idx" ON "_topics_v" USING btree ("latest");
  CREATE INDEX "posts_references_order_idx" ON "posts_references" USING btree ("_order");
  CREATE INDEX "posts_references_parent_id_idx" ON "posts_references" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "posts_slug_idx" ON "posts" USING btree ("slug");
  CREATE INDEX "posts_cover_idx" ON "posts" USING btree ("cover_id");
  CREATE INDEX "posts_seo_seo_image_idx" ON "posts" USING btree ("seo_image_id");
  CREATE INDEX "posts_updated_at_idx" ON "posts" USING btree ("updated_at");
  CREATE INDEX "posts_created_at_idx" ON "posts" USING btree ("created_at");
  CREATE INDEX "posts__status_idx" ON "posts" USING btree ("_status");
  CREATE INDEX "posts_rels_order_idx" ON "posts_rels" USING btree ("order");
  CREATE INDEX "posts_rels_parent_idx" ON "posts_rels" USING btree ("parent_id");
  CREATE INDEX "posts_rels_path_idx" ON "posts_rels" USING btree ("path");
  CREATE INDEX "posts_rels_topics_id_idx" ON "posts_rels" USING btree ("topics_id");
  CREATE INDEX "posts_rels_coaches_id_idx" ON "posts_rels" USING btree ("coaches_id");
  CREATE INDEX "posts_rels_posts_id_idx" ON "posts_rels" USING btree ("posts_id");
  CREATE INDEX "posts_rels_videos_id_idx" ON "posts_rels" USING btree ("videos_id");
  CREATE INDEX "_posts_v_version_references_order_idx" ON "_posts_v_version_references" USING btree ("_order");
  CREATE INDEX "_posts_v_version_references_parent_id_idx" ON "_posts_v_version_references" USING btree ("_parent_id");
  CREATE INDEX "_posts_v_parent_idx" ON "_posts_v" USING btree ("parent_id");
  CREATE INDEX "_posts_v_version_version_slug_idx" ON "_posts_v" USING btree ("version_slug");
  CREATE INDEX "_posts_v_version_version_cover_idx" ON "_posts_v" USING btree ("version_cover_id");
  CREATE INDEX "_posts_v_version_seo_version_seo_image_idx" ON "_posts_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_posts_v_version_version_updated_at_idx" ON "_posts_v" USING btree ("version_updated_at");
  CREATE INDEX "_posts_v_version_version_created_at_idx" ON "_posts_v" USING btree ("version_created_at");
  CREATE INDEX "_posts_v_version_version__status_idx" ON "_posts_v" USING btree ("version__status");
  CREATE INDEX "_posts_v_created_at_idx" ON "_posts_v" USING btree ("created_at");
  CREATE INDEX "_posts_v_updated_at_idx" ON "_posts_v" USING btree ("updated_at");
  CREATE INDEX "_posts_v_latest_idx" ON "_posts_v" USING btree ("latest");
  CREATE INDEX "_posts_v_rels_order_idx" ON "_posts_v_rels" USING btree ("order");
  CREATE INDEX "_posts_v_rels_parent_idx" ON "_posts_v_rels" USING btree ("parent_id");
  CREATE INDEX "_posts_v_rels_path_idx" ON "_posts_v_rels" USING btree ("path");
  CREATE INDEX "_posts_v_rels_topics_id_idx" ON "_posts_v_rels" USING btree ("topics_id");
  CREATE INDEX "_posts_v_rels_coaches_id_idx" ON "_posts_v_rels" USING btree ("coaches_id");
  CREATE INDEX "_posts_v_rels_posts_id_idx" ON "_posts_v_rels" USING btree ("posts_id");
  CREATE INDEX "_posts_v_rels_videos_id_idx" ON "_posts_v_rels" USING btree ("videos_id");
  CREATE UNIQUE INDEX "videos_slug_idx" ON "videos" USING btree ("slug");
  CREATE INDEX "videos_seo_seo_image_idx" ON "videos" USING btree ("seo_image_id");
  CREATE INDEX "videos_updated_at_idx" ON "videos" USING btree ("updated_at");
  CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");
  CREATE INDEX "videos__status_idx" ON "videos" USING btree ("_status");
  CREATE INDEX "videos_rels_order_idx" ON "videos_rels" USING btree ("order");
  CREATE INDEX "videos_rels_parent_idx" ON "videos_rels" USING btree ("parent_id");
  CREATE INDEX "videos_rels_path_idx" ON "videos_rels" USING btree ("path");
  CREATE INDEX "videos_rels_topics_id_idx" ON "videos_rels" USING btree ("topics_id");
  CREATE INDEX "videos_rels_posts_id_idx" ON "videos_rels" USING btree ("posts_id");
  CREATE INDEX "_videos_v_parent_idx" ON "_videos_v" USING btree ("parent_id");
  CREATE INDEX "_videos_v_version_version_slug_idx" ON "_videos_v" USING btree ("version_slug");
  CREATE INDEX "_videos_v_version_seo_version_seo_image_idx" ON "_videos_v" USING btree ("version_seo_image_id");
  CREATE INDEX "_videos_v_version_version_updated_at_idx" ON "_videos_v" USING btree ("version_updated_at");
  CREATE INDEX "_videos_v_version_version_created_at_idx" ON "_videos_v" USING btree ("version_created_at");
  CREATE INDEX "_videos_v_version_version__status_idx" ON "_videos_v" USING btree ("version__status");
  CREATE INDEX "_videos_v_created_at_idx" ON "_videos_v" USING btree ("created_at");
  CREATE INDEX "_videos_v_updated_at_idx" ON "_videos_v" USING btree ("updated_at");
  CREATE INDEX "_videos_v_latest_idx" ON "_videos_v" USING btree ("latest");
  CREATE INDEX "_videos_v_rels_order_idx" ON "_videos_v_rels" USING btree ("order");
  CREATE INDEX "_videos_v_rels_parent_idx" ON "_videos_v_rels" USING btree ("parent_id");
  CREATE INDEX "_videos_v_rels_path_idx" ON "_videos_v_rels" USING btree ("path");
  CREATE INDEX "_videos_v_rels_topics_id_idx" ON "_videos_v_rels" USING btree ("topics_id");
  CREATE INDEX "_videos_v_rels_posts_id_idx" ON "_videos_v_rels" USING btree ("posts_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_topics_fk" FOREIGN KEY ("topics_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_posts_fk" FOREIGN KEY ("posts_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_topics_id_idx" ON "payload_locked_documents_rels" USING btree ("topics_id");
  CREATE INDEX "payload_locked_documents_rels_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("posts_id");
  CREATE INDEX "payload_locked_documents_rels_videos_id_idx" ON "payload_locked_documents_rels" USING btree ("videos_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "topics" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_topics_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "posts_references" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "posts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "posts_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_posts_v_version_references" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_posts_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_posts_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "videos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "videos_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_videos_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_videos_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "topics" CASCADE;
  DROP TABLE "_topics_v" CASCADE;
  DROP TABLE "posts_references" CASCADE;
  DROP TABLE "posts" CASCADE;
  DROP TABLE "posts_rels" CASCADE;
  DROP TABLE "_posts_v_version_references" CASCADE;
  DROP TABLE "_posts_v" CASCADE;
  DROP TABLE "_posts_v_rels" CASCADE;
  DROP TABLE "videos" CASCADE;
  DROP TABLE "videos_rels" CASCADE;
  DROP TABLE "_videos_v" CASCADE;
  DROP TABLE "_videos_v_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_topics_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_posts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_videos_fk";
  
  DROP INDEX "payload_locked_documents_rels_topics_id_idx";
  DROP INDEX "payload_locked_documents_rels_posts_id_idx";
  DROP INDEX "payload_locked_documents_rels_videos_id_idx";
  ALTER TABLE "coaches" DROP COLUMN "bio";
  ALTER TABLE "_coaches_v" DROP COLUMN "version_bio";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "topics_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "posts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "videos_id";
  DROP TYPE "public"."enum_topics_status";
  DROP TYPE "public"."enum__topics_v_version_status";
  DROP TYPE "public"."enum_posts_status";
  DROP TYPE "public"."enum__posts_v_version_status";
  DROP TYPE "public"."enum_videos_category";
  DROP TYPE "public"."enum_videos_status";
  DROP TYPE "public"."enum__videos_v_version_category";
  DROP TYPE "public"."enum__videos_v_version_status";`)
}
