import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "intakes" (
      "member_id" integer PRIMARY KEY REFERENCES "public"."members"("id") ON DELETE cascade,
      "answers" jsonb NOT NULL CHECK (jsonb_typeof("answers") = 'object'),
      "share_with_coach" boolean DEFAULT false NOT NULL,
      "consented_at" timestamp(3) with time zone NOT NULL,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "intakes";`)
}
