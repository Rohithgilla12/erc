import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "races" ADD COLUMN "moderation_submitter_name" varchar;
  ALTER TABLE "races" ADD COLUMN "moderation_submitter_email" varchar;
  ALTER TABLE "races" ADD COLUMN "moderation_submitted_at" timestamp(3) with time zone;
  UPDATE "races" SET "moderation_submitted_at" = "created_at";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "races" DROP COLUMN "moderation_submitter_name";
  ALTER TABLE "races" DROP COLUMN "moderation_submitter_email";
  ALTER TABLE "races" DROP COLUMN "moderation_submitted_at";`)
}
