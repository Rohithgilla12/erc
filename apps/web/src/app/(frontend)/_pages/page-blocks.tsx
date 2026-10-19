import { isVerificationStale, todayIn, type CtaLink, type LocalDate, type PublicRace } from '@erc/domain'
import Image from 'next/image'
import React from 'react'

import { upcomingRaces, type PageBlock } from '@/content/pages'
import { RichText } from '@/content/rich-text'

import { StaleBadge, StatusBadge } from '../races/_components/badges'
import { dateParts, formatDates, formatDistance, placeOf } from '../races/_components/format'

import '../races/_components/races.css'
import './pages.css'

const isExternal = (link: CtaLink) => link.href.startsWith('https://')

function Button({ link, secondary = false }: { link: CtaLink; secondary?: boolean }) {
  return (
    <a className={secondary ? 'button button-secondary' : 'button'} href={link.href} rel={isExternal(link) ? 'noopener' : undefined}>
      {link.label}
    </a>
  )
}

function Hero({ block, level }: { block: Extract<PageBlock, { kind: 'hero' }>; level: 'h1' | 'h2' }) {
  const Heading = level
  const links = [block.primary, block.secondary].filter((link) => link !== null)
  return (
    <header className="block-hero">
      <Heading>{block.heading}</Heading>
      {block.body ? <p className="block-hero-body">{block.body}</p> : null}
      {links.length > 0 ? (
        <ul className="block-actions">
          {links.map((link, index) => (
            <li key={link.href}>
              <Button link={link} secondary={index > 0} />
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  )
}

function FeaturedRace({ race, today }: { race: PublicRace; today: LocalDate }) {
  const { weekday, day, month } = dateParts(race.dates.start)
  const flagged = race.status.kind !== 'scheduled' || isVerificationStale(race, today)
  return (
    <li className="race-card featured-race" data-status={race.status.kind}>
      <div className="date-tile" aria-hidden="true">
        <span className="date-tile-weekday">{weekday}</span>
        <span className="date-tile-day">{day}</span>
        <span className="date-tile-month">{month}</span>
      </div>
      <div className="race-body">
        <h3>
          <a href={`/races/${race.slug}`}>{race.name}</a>
        </h3>
        <p className="race-meta">
          <span>{formatDates(race.dates)}</span>
          <span>{placeOf(race)}</span>
        </p>
        <ul className="distance-tags" aria-label="Distances">
          {race.distances.map((option, index) => (
            <li key={index}>{formatDistance(option)}</li>
          ))}
        </ul>
        {flagged ? (
          <p className="badges">
            <StatusBadge status={race.status} />
            <StaleBadge race={race} today={today} />
          </p>
        ) : null}
      </div>
    </li>
  )
}

async function FeaturedRaces({ block }: { block: Extract<PageBlock, { kind: 'featuredRaces' }> }) {
  const races = await upcomingRaces(block.count)
  const today = todayIn('Asia/Kolkata')
  return (
    <section className="block">
      <h2>{block.heading}</h2>
      {races.length > 0 ? (
        <ul className="race-list">
          {races.map((race) => (
            <FeaturedRace key={race.id} race={race} today={today} />
          ))}
        </ul>
      ) : (
        <p className="block-empty">No upcoming races are listed yet.</p>
      )}
      <p>
        <a className="block-more" href="/races">
          See all upcoming races
        </a>
      </p>
    </section>
  )
}

function CoachGrid({ block }: { block: Extract<PageBlock, { kind: 'coachGrid' }> }) {
  if (block.coaches.length === 0) return null
  return (
    <section className="block">
      <h2>{block.heading ?? 'Coaches'}</h2>
      <ul className="coach-grid">
        {block.coaches.map((coach) => (
          <li key={coach.id} className="coach-card">
            {coach.photoUrl ? <Image className="coach-photo" src={coach.photoUrl} alt="" width={96} height={96} unoptimized /> : null}
            <div>
              <h3>{coach.name}</h3>
              <p className="coach-credentials">{coach.credentials}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Faq({ block }: { block: Extract<PageBlock, { kind: 'faq' }> }) {
  return (
    <section className="block">
      <h2>{block.heading ?? 'Questions and answers'}</h2>
      <div className="faq">
        {block.items.map((item, index) => (
          <details key={index} className="faq-item">
            <summary>
              {item.question}
              <svg className="faq-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 6 8 10.5 12.5 6" />
              </svg>
            </summary>
            <RichText value={item.answer} className="prose faq-answer" />
          </details>
        ))}
      </div>
    </section>
  )
}

function Block({ block, first }: { block: PageBlock; first: boolean }) {
  switch (block.kind) {
    case 'hero':
      return <Hero block={block} level={first ? 'h1' : 'h2'} />
    case 'richText':
      return <RichText value={block.body} className="prose block" />
    case 'featuredRaces':
      return <FeaturedRaces block={block} />
    case 'callToAction':
      return (
        <section className="block block-cta">
          <h2>{block.heading}</h2>
          {block.body ? <p>{block.body}</p> : null}
          <p>
            <Button link={block.link} />
          </p>
        </section>
      )
    case 'coachGrid':
      return <CoachGrid block={block} />
    case 'faq':
      return <Faq block={block} />
  }
}

/** A hero in first place is the page's heading; anywhere else it is a section heading. */
export function PageBlocks({ blocks }: { blocks: readonly PageBlock[] }) {
  return blocks.map((block, index) => <Block key={index} block={block} first={index === 0} />)
}
