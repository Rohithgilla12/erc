/**
 * The single list of Indian states and union territories: ISO 3166-2:IN after the 2023-11-23 update, which renamed
 * IN-TG to IN-TS, IN-CT to IN-CG, IN-OR to IN-OD and IN-UT to IN-UK. Codes are stored; slugs are public URLs, so a
 * slug stays fixed once published even if a name changes.
 */
export const INDIAN_SUBDIVISIONS = [
  { code: 'IN-AN', name: 'Andaman and Nicobar Islands', slug: 'andaman-and-nicobar-islands' },
  { code: 'IN-AP', name: 'Andhra Pradesh', slug: 'andhra-pradesh' },
  { code: 'IN-AR', name: 'Arunachal Pradesh', slug: 'arunachal-pradesh' },
  { code: 'IN-AS', name: 'Assam', slug: 'assam' },
  { code: 'IN-BR', name: 'Bihar', slug: 'bihar' },
  { code: 'IN-CH', name: 'Chandigarh', slug: 'chandigarh' },
  { code: 'IN-CG', name: 'Chhattisgarh', slug: 'chhattisgarh' },
  { code: 'IN-DH', name: 'Dadra and Nagar Haveli and Daman and Diu', slug: 'dadra-and-nagar-haveli-and-daman-and-diu' },
  { code: 'IN-DL', name: 'Delhi', slug: 'delhi' },
  { code: 'IN-GA', name: 'Goa', slug: 'goa' },
  { code: 'IN-GJ', name: 'Gujarat', slug: 'gujarat' },
  { code: 'IN-HR', name: 'Haryana', slug: 'haryana' },
  { code: 'IN-HP', name: 'Himachal Pradesh', slug: 'himachal-pradesh' },
  { code: 'IN-JK', name: 'Jammu and Kashmir', slug: 'jammu-and-kashmir' },
  { code: 'IN-JH', name: 'Jharkhand', slug: 'jharkhand' },
  { code: 'IN-KA', name: 'Karnataka', slug: 'karnataka' },
  { code: 'IN-KL', name: 'Kerala', slug: 'kerala' },
  { code: 'IN-LA', name: 'Ladakh', slug: 'ladakh' },
  { code: 'IN-LD', name: 'Lakshadweep', slug: 'lakshadweep' },
  { code: 'IN-MP', name: 'Madhya Pradesh', slug: 'madhya-pradesh' },
  { code: 'IN-MH', name: 'Maharashtra', slug: 'maharashtra' },
  { code: 'IN-MN', name: 'Manipur', slug: 'manipur' },
  { code: 'IN-ML', name: 'Meghalaya', slug: 'meghalaya' },
  { code: 'IN-MZ', name: 'Mizoram', slug: 'mizoram' },
  { code: 'IN-NL', name: 'Nagaland', slug: 'nagaland' },
  { code: 'IN-OD', name: 'Odisha', slug: 'odisha' },
  { code: 'IN-PY', name: 'Puducherry', slug: 'puducherry' },
  { code: 'IN-PB', name: 'Punjab', slug: 'punjab' },
  { code: 'IN-RJ', name: 'Rajasthan', slug: 'rajasthan' },
  { code: 'IN-SK', name: 'Sikkim', slug: 'sikkim' },
  { code: 'IN-TN', name: 'Tamil Nadu', slug: 'tamil-nadu' },
  { code: 'IN-TS', name: 'Telangana', slug: 'telangana' },
  { code: 'IN-TR', name: 'Tripura', slug: 'tripura' },
  { code: 'IN-UP', name: 'Uttar Pradesh', slug: 'uttar-pradesh' },
  { code: 'IN-UK', name: 'Uttarakhand', slug: 'uttarakhand' },
  { code: 'IN-WB', name: 'West Bengal', slug: 'west-bengal' },
] as const

export type IndianSubdivision = (typeof INDIAN_SUBDIVISIONS)[number]
/** ISO 3166-2 code such as `IN-TS` or `IN-AP`; only codes in `INDIAN_SUBDIVISIONS` exist. */
export type Subdivision = IndianSubdivision['code']

const BY_CODE = new Map<string, IndianSubdivision>(INDIAN_SUBDIVISIONS.map((s) => [s.code, s]))
const BY_SLUG = new Map<string, IndianSubdivision>(INDIAN_SUBDIVISIONS.map((s) => [s.slug, s]))

/** Any case and surrounding space are accepted; unknown and pre-2023 codes give null. */
export const parseSubdivision = (raw: string): Subdivision | null => BY_CODE.get(raw.trim().toUpperCase())?.code ?? null

export const subdivisionBySlug = (slug: string): IndianSubdivision | null => BY_SLUG.get(slug) ?? null

export const subdivisionOf = (code: Subdivision): IndianSubdivision => {
  const entry = BY_CODE.get(code)
  if (!entry) throw new Error(`Unknown subdivision ${code}`)
  return entry
}
