import { sql } from '@payloadcms/db-postgres/drizzle'
import { cityBySlug, type City, type CitySlug, type MemberId } from '@erc/domain'
import type { Payload } from 'payload'

/** The member's chosen city. A slug no longer in `CITIES` reads as no city, so a renamed entry never breaks a page. */
export async function readHomeCity(payload: Payload, member: MemberId): Promise<City | null> {
  const { rows } = await payload.db.drizzle.execute(sql`SELECT home_city FROM members WHERE id = ${member}`)
  const slug = (rows[0] as { home_city: string | null } | undefined)?.home_city
  return slug ? cityBySlug(slug) : null
}

/** Written straight to the row: the admin shows the field read-only, and no Payload hook has anything to do here. */
export async function saveHomeCity(payload: Payload, member: MemberId, city: CitySlug | null): Promise<void> {
  await payload.db.drizzle.execute(sql`UPDATE members SET home_city = ${city}, updated_at = now() WHERE id = ${member}`)
}
