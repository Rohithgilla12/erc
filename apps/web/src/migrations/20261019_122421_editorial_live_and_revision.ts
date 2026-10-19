import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "coaches" ALTER COLUMN "workflow" SET DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb;
  ALTER TABLE "_coaches_v" ALTER COLUMN "version_workflow" SET DEFAULT '{"live":{"kind":"none"},"revision":{"kind":"draft"}}'::jsonb;
  UPDATE "coaches" SET "workflow" = CASE WHEN "workflow"->>'kind' = 'published'
    THEN jsonb_build_object('live', "workflow", 'revision', '{"kind":"none"}'::jsonb)
    ELSE jsonb_build_object('live', '{"kind":"none"}'::jsonb, 'revision', "workflow") END
  WHERE "workflow" ? 'kind';
  UPDATE "_coaches_v" SET "version_workflow" = CASE WHEN "version_workflow"->>'kind' = 'published'
    THEN jsonb_build_object('live', "version_workflow", 'revision', '{"kind":"none"}'::jsonb)
    ELSE jsonb_build_object('live', '{"kind":"none"}'::jsonb, 'revision', "version_workflow") END
  WHERE "version_workflow" ? 'kind';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "coaches" ALTER COLUMN "workflow" SET DEFAULT '{"kind":"draft"}'::jsonb;
  ALTER TABLE "_coaches_v" ALTER COLUMN "version_workflow" SET DEFAULT '{"kind":"draft"}'::jsonb;
  UPDATE "coaches" SET "workflow" = CASE WHEN "workflow"->'revision'->>'kind' = 'none'
    THEN "workflow"->'live' ELSE "workflow"->'revision' END
  WHERE "workflow" ? 'live';
  UPDATE "_coaches_v" SET "version_workflow" = CASE WHEN "version_workflow"->'revision'->>'kind' = 'none'
    THEN "version_workflow"->'live' ELSE "version_workflow"->'revision' END
  WHERE "version_workflow" ? 'live';`)
}
