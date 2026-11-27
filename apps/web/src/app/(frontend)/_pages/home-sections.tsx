import { todayIn } from '@erc/domain'
import React from 'react'

import { findNews } from '@/content/news'
import { findNearestRaces } from '@/content/races'
import { viewerHomeCity } from '@/members/run'

import { NewsList } from '../news/_components/news-list'
import { formatRaceDistance } from '../races/_components/near'

import { FeaturedRace } from './page-blocks'

const NEAR_COUNT = 3
const NEWS_COUNT = 3

/** Shown only to a signed-in member who has chosen a home city; everyone else sees the page as editors built it. */
export async function RacesNearYou() {
  const city = await viewerHomeCity()
  if (!city) return null
  const races = (await findNearestRaces(city)).slice(0, NEAR_COUNT)
  const today = todayIn('Asia/Kolkata')
  return (
    <section className="block" aria-labelledby="races-near-you">
      <h2 id="races-near-you">Races near you</h2>
      {races.length > 0 ? (
        <ul className="race-list featured-race-list">
          {races.map(({ race, distance }) => (
            <FeaturedRace key={race.id} race={race} today={today} distance={formatRaceDistance(distance, city)} />
          ))}
        </ul>
      ) : (
        <p className="block-empty">No upcoming races are listed yet.</p>
      )}
      <p>
        <a className="block-more" href={`/races?near=${city.slug}`}>
          More races near {city.name}
        </a>
      </p>
    </section>
  )
}

/** Shown once staff have published news; an empty section would only advertise that there is none. */
export async function LatestNews() {
  const items = (await findNews(1)).items.slice(0, NEWS_COUNT)
  if (items.length === 0) return null
  return (
    <section className="block" aria-labelledby="latest-news">
      <h2 id="latest-news">News</h2>
      <NewsList items={items} headingLevel="h3" />
      <p>
        <a className="block-more" href="/news">
          See all news
        </a>
      </p>
    </section>
  )
}
