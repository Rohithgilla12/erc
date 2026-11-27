import { parseShoeCategory, SHOE_CATEGORIES, type ShoeCategory } from '@erc/domain'
import type { Metadata } from 'next'
import { connection } from 'next/server'

import { getShoes } from '@/content/reviews'

import { RatingLine } from '../_feedback/feedback'
import { breadcrumbList, JsonLd } from '../structured-data'

import './shoes.css'

type Props = { searchParams: Promise<{ category?: string | string[] }> }

const DESCRIPTION = 'Running shoes reviewed by Endurance Run Club members: what each is for, and what runners who ran in them found.'

const labelOf = (category: ShoeCategory) => SHOE_CATEGORIES.find(({ key }) => key === category)?.label ?? category

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const category = parseShoeCategory((await searchParams).category)
  return {
    title: category ? `${labelOf(category)} shoes` : 'Shoes',
    description: DESCRIPTION,
    // A filtered list is the same shoes as the full one, so it points search engines there.
    alternates: { canonical: '/shoes' },
  }
}

export default async function ShoesPage({ searchParams }: Props) {
  // Read per request, never at build time: the image is built without a database.
  await connection()
  const category = parseShoeCategory((await searchParams).category)
  const shoes = await getShoes(category)

  return (
    <div className="page shoes">
      <JsonLd data={{ '@graph': [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Shoes', path: '/shoes' }])] }} />
      <header className="shoes-head">
        <h1>Shoes</h1>
        <p className="lede">Shoes club runners use, with reviews from members who have run in them. Ratings count approved reviews only.</p>
      </header>

      <nav aria-label="Shoe categories">
        <ul className="shoe-filters">
          <li>
            <a className="pill" href="/shoes" aria-current={category === null ? 'page' : undefined}>
              All
            </a>
          </li>
          {SHOE_CATEGORIES.map(({ key, label }) => (
            <li key={key}>
              <a className="pill" href={`/shoes?category=${key}`} aria-current={category === key ? 'page' : undefined}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {shoes.length === 0 ? <p className="empty">{category ? 'No shoes in this category yet.' : 'Shoes are on their way.'}</p> : null}

      <ul className="shoe-list">
        {shoes.map((shoe) => (
          <li key={shoe.slug} className="shoe-item">
            {shoe.image ? <img src={shoe.image.url} alt="" className="shoe-thumb" loading="lazy" /> : null}
            <div className="shoe-item-text">
              <p className="shoe-brand">
                {shoe.brand} <span aria-hidden="true">·</span> {labelOf(shoe.category)}
              </p>
              <h2>
                <a href={`/shoes/${shoe.slug}`}>{shoe.model}</a>
              </h2>
              <RatingLine rating={shoe.rating} />
              <p className="shoe-description">{shoe.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
