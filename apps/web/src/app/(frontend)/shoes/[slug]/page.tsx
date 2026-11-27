import { SHOE_CATEGORIES } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getShoe } from '@/content/reviews'

import { RatingLine, ReviewsSection } from '../../_feedback/feedback'
import { breadcrumbList, JsonLd } from '../../structured-data'

import '../shoes.css'

type Props = { params: Promise<{ slug: string }> }

const shoeOf = async (params: Props['params']) => {
  const shoe = await getShoe((await params).slug)
  if (!shoe) notFound()
  return shoe
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shoe = await shoeOf(params)
  return { title: `${shoe.brand} ${shoe.model}`, description: shoe.description, alternates: { canonical: `/shoes/${shoe.slug}` } }
}

export default async function ShoePage({ params }: Props) {
  const shoe = await shoeOf(params)
  const path = `/shoes/${shoe.slug}`
  const category = SHOE_CATEGORIES.find(({ key }) => key === shoe.category)

  return (
    <article className="page shoe-detail">
      <JsonLd
        data={{
          '@graph': [
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Shoes', path: '/shoes' },
              { name: `${shoe.brand} ${shoe.model}`, path },
            ]),
          ],
        }}
      />
      <header className="shoe-detail-head">
        <a className="back-link" href="/shoes">
          All shoes
        </a>
        <p className="shoe-brand">{shoe.brand}</p>
        <h1>{shoe.model}</h1>
        {shoe.rating.count > 0 ? <RatingLine rating={shoe.rating} /> : null}
      </header>
      {shoe.image ? <img src={shoe.image.url} alt={shoe.image.alt} className="shoe-image" /> : null}
      <dl className="shoe-facts">
        <dt>Category</dt>
        <dd>
          <a href={`/shoes?category=${shoe.category}`}>{category?.label ?? shoe.category}</a>
        </dd>
      </dl>
      <p className="shoe-about">{shoe.description}</p>
      <ReviewsSection subject={{ kind: 'shoes', id: shoe.id }} path={path} noun="shoe" />
    </article>
  )
}
