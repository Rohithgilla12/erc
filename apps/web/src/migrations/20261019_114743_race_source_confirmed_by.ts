import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "races" DROP CONSTRAINT "races_source_coach_id_coaches_id_fk";
  
  DROP INDEX "races_source_source_coach_idx";
  ALTER TABLE "races" ADD COLUMN "source_confirmed_by_id" integer;
  ALTER TABLE "races" ADD CONSTRAINT "races_source_confirmed_by_id_staff_id_fk" FOREIGN KEY ("source_confirmed_by_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "races_source_source_confirmed_by_idx" ON "races" USING btree ("source_confirmed_by_id");
  ALTER TABLE "races" DROP COLUMN "source_coach_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "races" DROP CONSTRAINT "races_source_confirmed_by_id_staff_id_fk";
  
  DROP INDEX "races_source_source_confirmed_by_idx";
  ALTER TABLE "races" ADD COLUMN "source_coach_id" integer;
  ALTER TABLE "races" ADD CONSTRAINT "races_source_coach_id_coaches_id_fk" FOREIGN KEY ("source_coach_id") REFERENCES "public"."coaches"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "races_source_source_coach_idx" ON "races" USING btree ("source_coach_id");
  ALTER TABLE "races" DROP COLUMN "source_confirmed_by_id";`)
}
