import {
  ANONYMOUS,
  canAccess,
  goalLabel,
  PLAN_LEVEL_LABELS,
  planWeekCount,
  SESSION_INTENSITY_LABELS,
  type AccessTier,
  type PlanSession,
  type TrainingPlan,
} from '@erc/domain'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getPlan } from '@/content/plans'
import { downloadPath } from '@/content/resources'
import { RichText } from '@/content/rich-text'
import { siteConfig } from '@/site-config'

import { CLUB } from '../../site-nav'
import { accessLabel, describeFile, formatTarget, formatWeeks, jsonLd, planLabels } from '../_components/format'

import '../_components/plans.css'

type Props = { params: Promise<{ slug: string }> }

const planOf = async (params: Props['params']) => {
  const plan = await getPlan((await params).slug)
  if (!plan) notFound()
  return plan
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const plan = await planOf(params)
  return {
    title: plan.seo.title,
    description: plan.seo.description,
    alternates: { canonical: `/plans/${plan.slug}` },
    openGraph: { type: 'article', title: plan.seo.title, description: plan.seo.description, ...(plan.seo.imageUrl ? { images: [plan.seo.imageUrl] } : {}) },
    ...(plan.seo.noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

const offerOf = (access: AccessTier): Record<string, unknown> => {
  switch (access.kind) {
    case 'free':
      return { '@type': 'Offer', price: 0, priceCurrency: 'INR', category: 'Free' }
  }
}

/**
 * `Course`, not `HowTo`: a plan is followed over weeks rather than done in one sitting, and Course has a property for
 * each label the brief requires (educationalLevel, coursePrerequisites, audience, timeRequired) plus `offers`, where
 * a Phase 3 price belongs.
 */
const course = (plan: TrainingPlan) => {
  const site = siteConfig().siteUrl
  const url = new URL(`/plans/${plan.slug}`, site).href
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    '@id': url,
    url,
    name: plan.title,
    description: plan.seo.description,
    about: `${goalLabel(plan.goal)} running`,
    educationalLevel: PLAN_LEVEL_LABELS[plan.level],
    coursePrerequisites: plan.prerequisites,
    audience: { '@type': 'Audience', audienceType: plan.audience },
    timeRequired: `P${planWeekCount(plan)}W`,
    datePublished: plan.publishedAt,
    dateModified: plan.updatedAt,
    inLanguage: 'en-IN',
    isAccessibleForFree: plan.access.kind === 'free',
    offers: offerOf(plan.access),
    provider: { '@type': 'SportsOrganization', name: CLUB.name, url: site.href },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'Online',
      ...(plan.coaches.length > 0 ? { instructor: plan.coaches.map((coach) => ({ '@type': 'Person', name: coach.name })) } : {}),
    },
    ...(plan.pdf
      ? {
          hasPart: {
            '@type': 'DigitalDocument',
            name: plan.pdf.title,
            url: new URL(downloadPath(plan.pdf), site).href,
            encodingFormat: plan.pdf.file.mimeType,
          },
        }
      : {}),
    ...(plan.seo.imageUrl ? { image: plan.seo.imageUrl } : {}),
  }
}

const credit = (plan: TrainingPlan) =>
  plan.coaches.length === 0 ? 'ERC coaches' : new Intl.ListFormat('en-GB', { type: 'conjunction' }).format(plan.coaches.map((coach) => coach.name))

export default async function PlanPage({ params }: Props) {
  const plan = await planOf(params)
  // Labels and overview are always public so a runner can judge the plan; the schedule and PDF are what access buys.
  const open = canAccess(ANONYMOUS, plan.access)

  return (
    <article className="page plan-detail">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(course(plan))} />
      <header className="plan-head">
        <a className="back-link" href="/plans">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
          All plans
        </a>
        <h1>{plan.title}</h1>
        <ul className="plan-tags" aria-label="Plan details">
          {planLabels(plan).map((label) => (
            <li key={label}>{label}</li>
          ))}
          <li className="plan-tag-access">{accessLabel(plan.access)}</li>
        </ul>
        <p className="plan-credit">Written by {credit(plan)}</p>
        {open && plan.pdf ? (
          <p>
            <a className="button" href={downloadPath(plan.pdf)}>
              <DownloadIcon />
              Download the printable plan
              <span className="button-note">{describeFile(plan.pdf.file)}</span>
            </a>
          </p>
        ) : null}
      </header>

      <dl className="plan-facts">
        <dt>Who it is for</dt>
        <dd>{plan.audience}</dd>
        <dt>Before you start</dt>
        <dd>{plan.prerequisites}</dd>
        <dt>Goal</dt>
        <dd>{goalLabel(plan.goal)}</dd>
        <dt>Level</dt>
        <dd>{PLAN_LEVEL_LABELS[plan.level]}</dd>
        <dt>Length</dt>
        <dd>{formatWeeks(plan)}</dd>
      </dl>

      <section aria-labelledby="overview-heading">
        <h2 id="overview-heading">About this plan</h2>
        <RichText value={plan.overview} />
      </section>

      {open ? <PlanContent plan={plan} /> : null}

      {plan.coaches.length > 0 ? (
        <section aria-labelledby="coaches-heading">
          <h2 id="coaches-heading">{plan.coaches.length === 1 ? 'Your coach' : 'Your coaches'}</h2>
          <ul className="plan-coaches">
            {plan.coaches.map((coach) => (
              <li key={coach.slug}>
                <strong>{coach.name}</strong>
                <span>{coach.credentials}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function PlanContent({ plan }: { plan: TrainingPlan }) {
  return (
    <>
      <section className="plan-schedule" aria-labelledby="schedule-heading">
        <p className="print-title">
          {plan.title}: {planLabels(plan).join(', ')}
        </p>
        <h2 id="schedule-heading">Week by week</h2>
        <p className="schedule-hint">Days count from the start of each week, so day 1 can be whichever day suits you.</p>
        <ol className="weeks">
          {plan.weeks.map((week, index) => (
            <li key={index} className="week">
              <h3>
                Week {index + 1}
                <span className="week-focus">{week.focus}</span>
              </h3>
              <ol className="sessions">
                {week.sessions.map((session, at) => (
                  <Session key={at} session={session} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </section>

      {plan.strength ? (
        <section aria-labelledby="strength-heading">
          <h2 id="strength-heading">Strength</h2>
          <RichText value={plan.strength} />
        </section>
      ) : null}

      {plan.recovery ? (
        <section aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">Recovery</h2>
          <RichText value={plan.recovery} />
        </section>
      ) : null}
    </>
  )
}

function Session({ session }: { session: PlanSession }) {
  const target = formatTarget(session.target)
  return (
    <li className="session" data-intensity={session.intensity}>
      <span className="session-day">Day {session.day}</span>
      <div className="session-body">
        <p className="session-title">{session.title}</p>
        <p className="session-meta">
          <span className="intensity">{SESSION_INTENSITY_LABELS[session.intensity]}</span>
          {target ? <span>{target}</span> : null}
        </p>
        {session.notes ? <p className="session-notes">{session.notes}</p> : null}
      </div>
    </li>
  )
}

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>
)
