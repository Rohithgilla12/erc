/** The one list of top-level sections. Header, footer and sitemap read it, so adding a section is one line. */
export const SITE_SECTIONS = [
  { href: '/races', label: 'Races' },
  { href: '/learn', label: 'Learn' },
  { href: '/videos', label: 'Videos' },
  { href: '/plans', label: 'Training plans' },
  { href: '/athletes', label: 'Athletes' },
  { href: '/coaching', label: 'Coaching' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const

export const CLUB = {
  name: 'Endurance Run Club',
  shortName: 'ERC',
  tagline: 'Run far. Run strong. Run smart.',
  motto: 'Show up. Do the work. Become stronger.',
  description: 'Performance-first endurance running: training, recovery and racing.',
  instagramUrl: 'https://www.instagram.com/endurancerunclubindia/',
} as const

export const isCurrentSection = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)
