import { formatFinishTime, subdivisionBySlug, subdivisionOf, type IndianSubdivision, type Subdivision } from '@erc/domain'
import type { Metadata } from 'next'

import { listAthletes, type DirectoryEntry } from '@/content/athletes'

import { Avatar, breadcrumbs, homeOf, JsonLd, Proof } from './_components/athlete-parts'

import './_components/athletes.css'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** An unknown state is no filter at all, so a stale or mistyped link still lands on the directory. */
const stateOf = async (searchParams: Props['searchParams']): Promise<IndianSubdivision | null> => {
  const raw = (await searchParams).state
  const slug = Array.isArray(raw) ? raw[0] : raw
  return slug ? subdivisionBySlug(slug) : null
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const state = await stateOf(searchParams)
  return {
    title: state ? `Athletes in ${state.name}` : 'Athletes',
    description: 'Endurance Run Club athletes who share their racing: personal bests and ultra finishes, entered by ERC coaches.',
    alternates: { canonical: '/athletes' },
    // A state view is the directory narrowed, not a page of its own.
    ...(state ? { robots: { index: false, follow: true } } : {}),
  }
}

const stateCounts = (entries: readonly DirectoryEntry[]) => {
  const counts = new Map<Subdivision, number>()
  for (const { athlete } of entries) counts.set(athlete.home.subdivision, (counts.get(athlete.home.subdivision) ?? 0) + 1)
  return [...counts]
    .map(([code, count]) => ({ state: subdivisionOf(code), count }))
    .sort((a, b) => b.count - a.count || a.state.name.localeCompare(b.state.name))
}

export default async function AthletesPage({ searchParams }: Props) {
  const [entries, state] = await Promise.all([listAthletes(), stateOf(searchParams)])
  const shown = state ? entries.filter(({ athlete }) => athlete.home.subdivision === state.code) : entries

  return (
    <div className="page athletes-page">
      <JsonLd value={breadcrumbs([{ name: 'Home', path: '/' }, { name: 'Athletes', path: '/athletes' }])} />
      <header className="athletes-head">
        <h1>Athletes</h1>
        <p className="athletes-lede">Club runners who chose to share their racing.</p>
        <aside className="athletes-note" aria-label="About these results">
          <p>
            ERC coaches enter every result here. <strong>Verified</strong> means an official race result published by the
            organiser; anything else is marked <strong>self-reported</strong>. Each athlete decides whether their profile and
            their results are public.
          </p>
        </aside>
      </header>

      {entries.length > 0 ? (
        <nav className="state-filter" aria-label="Filter by state">
          <ul className="chips">
            <li>
              <a className="chip" href="/athletes" aria-current={state ? undefined : 'true'}>
                All states <span className="count">{entries.length}</span>
              </a>
            </li>
            {stateCounts(entries).map(({ state: option, count }) => (
              <li key={option.code}>
                <a
                  className="chip"
                  href={`/athletes?state=${option.slug}`}
                  aria-current={state?.code === option.code ? 'true' : undefined}
                  rel="nofollow"
                >
                  {option.name} <span className="count">{count}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <section aria-label={state ? `Athletes in ${state.name}` : 'All athletes'}>
        {shown.length === 0 ? (
          <p className="empty">
            {state ? (
              <>
                No athletes from {state.name} share a profile yet. <a href="/athletes">See every athlete</a>.
              </>
            ) : (
              'No athlete profiles are public yet.'
            )}
          </p>
        ) : (
          <ul className="athlete-grid">
            {shown.map((entry) => (
              <AthleteCard key={entry.athlete.id} entry={entry} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function AthleteCard({ entry: { athlete, headline } }: { entry: DirectoryEntry }) {
  return (
    <li className="athlete-card">
      <div className="athlete-card-head">
        <Avatar athlete={athlete} size="card" />
        <div>
          <h2>
            <a href={`/athletes/${athlete.slug}`}>{athlete.name}</a>
          </h2>
          <p className="athlete-home">{homeOf(athlete)}</p>
        </div>
      </div>
      {athlete.visibility.results === 'hidden' ? (
        <p className="athlete-card-quiet">Results kept private</p>
      ) : headline.length === 0 ? (
        <p className="athlete-card-quiet">No results yet</p>
      ) : (
        <dl className="headline-bests">
          {headline.map((best) => (
            <div key={best.category}>
              <dt>{best.label}</dt>
              <dd>
                <span className="finish-time">{formatFinishTime(best.time)}</span>
                <Proof verified={best.verified} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}
