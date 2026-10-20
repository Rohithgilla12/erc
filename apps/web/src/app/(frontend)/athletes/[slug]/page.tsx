import { DISTANCE_CATEGORIES, formatFinishTime, type Achievements, type RaceResult } from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getAthleteProfile, type AthleteProfile, type RaceSlugs } from '@/content/athletes'
import { absoluteUrl } from '@/site-config'

import {
  Avatar,
  BackLink,
  categoryLabel,
  distanceLabel,
  formatResultDate,
  homeOf,
  Proof,
} from '../_components/athlete-parts'
import { breadcrumbList, JsonLd } from '../../structured-data'

import '../_components/athletes.css'

type Props = { params: Promise<{ slug: string }> }

const profileOf = async (params: Props['params']) => {
  const profile = await getAthleteProfile((await params).slug)
  if (!profile) notFound()
  return profile
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { athlete } = await profileOf(params)
  return {
    title: athlete.name,
    description: `${athlete.name}, ${homeOf(athlete)}. ${athlete.bio || 'An Endurance Run Club athlete.'}`,
    alternates: { canonical: `/athletes/${athlete.slug}` },
  }
}

/** Only the name and the profile's own address: nothing here may reveal what the athlete has not made public. */
const profilePage = ({ athlete }: AthleteProfile) => ({
  '@type': 'ProfilePage',
  url: absoluteUrl(`/athletes/${athlete.slug}`),
  mainEntity: { '@type': 'Person', name: athlete.name, url: absoluteUrl(`/athletes/${athlete.slug}`) },
})

export default async function AthletePage({ params }: Props) {
  const profile = await profileOf(params)
  const { athlete, record, raceSlugs } = profile
  const facts = [homeOf(athlete), ...(athlete.runningSince ? [`Running since ${athlete.runningSince}`] : [])]

  return (
    <article className="page athlete-page">
      <JsonLd
        data={{
          '@graph': [
            profilePage(profile),
            breadcrumbList([
              { name: 'Home', path: '/' },
              { name: 'Athletes', path: '/athletes' },
              { name: athlete.name, path: `/athletes/${athlete.slug}` },
            ]),
          ],
        }}
      />
      <header className="athlete-head">
        <BackLink href="/athletes">All athletes</BackLink>
        <div className="athlete-identity">
          <Avatar athlete={athlete} size="profile" />
          <div>
            <h1>{athlete.name}</h1>
            <p className="athlete-home">{facts.join(' · ')}</p>
          </div>
        </div>
        {athlete.bio ? <p className="athlete-bio">{athlete.bio}</p> : null}
      </header>

      {record.visibility === 'hidden' ? (
        <p className="empty">{athlete.name} keeps their race results private.</p>
      ) : record.results.length === 0 ? (
        <p className="empty">No results yet. ERC coaches add results after races.</p>
      ) : (
        <>
          <PersonalBests achievements={record.achievements} results={record.results} raceSlugs={raceSlugs} />
          <UltraFinishes finishes={record.achievements.ultraFinishes} />
          <ResultList results={record.results} raceSlugs={raceSlugs} />
        </>
      )}
    </article>
  )
}

function EventName({ result, raceSlugs }: { result: RaceResult; raceSlugs: RaceSlugs }) {
  const slug = result.race === null ? undefined : raceSlugs[result.race]
  return slug ? <a href={`/races/${slug}`}>{result.eventName}</a> : <>{result.eventName}</>
}

function PersonalBests({ achievements, results, raceSlugs }: { achievements: Achievements; results: readonly RaceResult[]; raceSlugs: RaceSlugs }) {
  const byId = new Map(results.map((result) => [result.id, result]))
  const bests = DISTANCE_CATEGORIES.flatMap(({ key, label }) => {
    const best = achievements.bests[key]
    const result = best && byId.get(best.result)
    return best && result ? [{ key, label, best, result }] : []
  })
  if (bests.length === 0) return null
  return (
    <section aria-labelledby="bests-heading">
      <h2 id="bests-heading">Personal bests</h2>
      <ul className="best-list">
        {bests.map(({ key, label, best, result }) => (
          <li key={key} className="best">
            <span className="best-distance">{label}</span>
            <span className="finish-time best-time">{formatFinishTime(best.time)}</span>
            <Proof verified={best.verified} />
            <span className="best-event">
              <EventName result={result} raceSlugs={raceSlugs} />, {formatResultDate(result.date)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function UltraFinishes({ finishes }: { finishes: Achievements['ultraFinishes'] }) {
  if (finishes.length === 0) return null
  return (
    <section aria-labelledby="ultras-heading">
      <h2 id="ultras-heading">Ultra finishes</h2>
      <ul className="ultra-list">
        {finishes.map((finish) => (
          <li key={`${finish.date}-${finish.category}-${finish.eventName}`}>
            <span className="ultra-category">{categoryLabel(finish.category)}</span>
            <span>
              {finish.eventName}, {formatResultDate(finish.date)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SourceLink({ provenance }: { provenance: RaceResult['provenance'] }) {
  const url = provenance.kind === 'official' ? provenance.timingUrl : provenance.evidenceUrl
  if (!url) return null
  return (
    <a className="result-source" href={url} rel="noopener nofollow">
      {provenance.kind === 'official' ? 'Official timing' : 'Evidence'}
    </a>
  )
}

function ResultList({ results, raceSlugs }: { results: readonly RaceResult[]; raceSlugs: RaceSlugs }) {
  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading">Results</h2>
      <ol className="result-list">
        {results.map((result) => (
          <li key={result.id} className="result">
            <span className="result-date">{formatResultDate(result.date)}</span>
            <span className="result-event">
              <EventName result={result} raceSlugs={raceSlugs} />
            </span>
            <span className="result-distance">{distanceLabel(result.category, result.distance)}</span>
            <span className="finish-time result-time">{formatFinishTime(result.time)}</span>
            <Proof verified={result.provenance.kind === 'official'} />
            <SourceLink provenance={result.provenance} />
          </li>
        ))}
      </ol>
    </section>
  )
}
