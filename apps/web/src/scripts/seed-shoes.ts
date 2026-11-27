/**
 * Lists widely sold running shoes so members have something to review: `pnpm payload run src/scripts/seed-shoes.ts`.
 * Each shoe is matched by slug and added only if missing, so a re-run leaves what staff edited in the admin alone.
 * Descriptions name the model line, not a version, and say only what holds across recent versions; staff add images
 * and version detail in the admin.
 */
import config from '@payload-config'
import type { ShoeCategory } from '@erc/domain'
import { getPayload } from 'payload'

import { collectionTag, refreshRunningSite } from '@/cms/revalidate'

type Seed = { slug: string; brand: string; model: string; category: ShoeCategory; description: string }

const SHOES: readonly Seed[] = [
  {
    slug: 'asics-novablast',
    brand: 'ASICS',
    model: 'Novablast',
    category: 'road-daily',
    description: 'A neutral road shoe with a thick, bouncy foam midsole, made for everyday training from easy runs to steady efforts.',
  },
  {
    slug: 'nike-pegasus',
    brand: 'Nike',
    model: 'Pegasus',
    category: 'road-daily',
    description: "Nike's long-running neutral daily trainer for road running, with Air Zoom cushioning units in a foam midsole.",
  },
  {
    slug: 'brooks-ghost',
    brand: 'Brooks',
    model: 'Ghost',
    category: 'road-daily',
    description: "A neutral daily trainer for road running, cushioned with Brooks' DNA Loft foam and built for a smooth, even ride.",
  },
  {
    slug: 'hoka-clifton',
    brand: 'Hoka',
    model: 'Clifton',
    category: 'road-daily',
    description: 'A lightweight neutral road shoe with a high stack of cushioning and a rocker shape, made for daily and long runs.',
  },
  {
    slug: 'adidas-adizero-boston',
    brand: 'Adidas',
    model: 'Adizero Boston',
    category: 'road-tempo',
    description: 'An uptempo road trainer with Lightstrike Pro foam and stiffening Energyrods in the midsole, made for tempo runs, intervals and long runs at pace.',
  },
  {
    slug: 'saucony-endorphin-speed',
    brand: 'Saucony',
    model: 'Endorphin Speed',
    category: 'road-tempo',
    description: 'A road trainer for faster sessions with PWRRUN PB foam and a nylon plate, which keeps it more flexible than a carbon-plated racer.',
  },
  {
    slug: 'puma-deviate-nitro',
    brand: 'Puma',
    model: 'Deviate Nitro',
    category: 'road-tempo',
    description: "A plated road shoe with Puma's nitrogen-infused Nitro foam and a carbon-composite plate, made for tempo work and long runs.",
  },
  {
    slug: 'kiprun-kd900',
    brand: 'Kiprun',
    model: 'KD900',
    category: 'road-tempo',
    description: "A road running shoe from Kiprun, Decathlon's own running brand, sold in Decathlon stores across India. It sits at the performance end of the Kiprun range.",
  },
  {
    slug: 'nike-vaporfly',
    brand: 'Nike',
    model: 'Vaporfly',
    category: 'racing',
    description: 'A road racing shoe with ZoomX foam and a full-length carbon-fibre plate, made for race day from 5K to the marathon.',
  },
  {
    slug: 'hoka-speedgoat',
    brand: 'Hoka',
    model: 'Speedgoat',
    category: 'trail',
    description: 'A cushioned trail shoe with a lugged Vibram Megagrip outsole, made for long runs on rough and technical ground.',
  },
]

const payload = await getPayload({ config })
const context = { skipRevalidation: true }

for (const shoe of SHOES) {
  const { docs } = await payload.find({ collection: 'shoes', where: { slug: { equals: shoe.slug } }, limit: 1, depth: 0 })
  if (docs[0]) {
    console.log(`Kept ${shoe.brand} ${shoe.model} as it is`)
    continue
  }
  await payload.create({ collection: 'shoes', data: shoe, context })
  console.log(`Added ${shoe.brand} ${shoe.model}`)
}

await refreshRunningSite(payload, [collectionTag('shoes')])
process.exit(0)
