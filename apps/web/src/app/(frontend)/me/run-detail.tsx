import type { RunDetailView } from '@erc/contract'
import { CLUB_TIME_ZONE, formatDuration, formatKm, type Metres, type Seconds, type WorkoutType } from '@erc/domain'
import React from 'react'

import { km, TraceStack, ZoneBars } from './run-charts'

const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CLUB_TIME_ZONE })

const pace = (secondsPerKm: number) => `${formatDuration(Math.round(secondsPerKm) as Seconds)} /km`
const paceOf = (metres: number, seconds: number) => (metres > 0 ? pace(seconds / (metres / 1000)) : '–')
const rounded = (value: number) => String(Math.round(value))
const minutes = (secondsPerKm: number) => formatDuration(Math.round(secondsPerKm) as Seconds)
const whole = (value: number | null, unit: string) => (value === null ? '–' : `${Math.round(value)} ${unit}`)

const WORKOUT_LABELS: Record<WorkoutType, string> = { default: 'Run', race: 'Race', long: 'Long run', workout: 'Workout' }

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Per-km speed as a bar length, from the slowest full split to the fastest, so the shape of the run shows at a glance. */
function splitBars(splits: RunDetailView['splits']) {
  const full = splits.filter((split) => split.distance >= FULL_SPLIT_METRES && split.moving > 0)
  const speeds = full.map((split) => split.distance / split.moving)
  const [slowest, fastest] = [Math.min(...speeds), Math.max(...speeds)]
  const fastestIndex = full.length > 1 ? full[speeds.indexOf(fastest)]?.index : undefined
  const widthOf = (split: RunDetailView['splits'][number]) => {
    if (split.moving <= 0 || full.length === 0) return 0
    const t = fastest > slowest ? (split.distance / split.moving - slowest) / (fastest - slowest) : 1
    return 35 + Math.max(0, Math.min(1, t)) * 65
  }
  return { fastestIndex, widthOf }
}

const FULL_SPLIT_METRES = 950

/** A headline number with its unit set smaller, so "4:49 /km" reads as one figure and fits a phone. */
function Measure({ text }: { text: string }) {
  const [value, ...unit] = text.split(' ')
  return (
    <>
      {value}
      {unit.length > 0 ? <span className="run-unit"> {unit.join(' ')}</span> : null}
    </>
  )
}

type Props = { detail: RunDetailView; viewer: 'self' | 'coach' }

export function RunDetailBody({ detail, viewer }: Props) {
  const { run, metrics, splits, laps, bestEfforts, charts, zones, syncing } = detail
  const zoneTotal = zones ? zones.zones.reduce((sum, zone) => sum + zone.seconds, 0) : 0
  const whose = viewer === 'self' ? 'your' : "the athlete's"
  const bars = splitBars(splits)

  return (
    <article className="run-detail">
      <header className="run-head">
        <p className="run-when">
          <span>
            <time dateTime={run.on}>{day.format(new Date(`${run.on}T00:00:00Z`))}</time>
            {metrics ? `, ${clock.format(new Date(metrics.startAt))} IST` : null}
            {run.source === 'strava' ? ' · from Strava' : null}
            {metrics?.deviceName ? ` · ${metrics.deviceName}` : null}
          </span>
          {metrics?.workoutType && metrics.workoutType !== 'default' ? <span className="run-tag">{WORKOUT_LABELS[metrics.workoutType]}</span> : null}
        </p>
        <h1>{run.note ?? 'Run'}</h1>
      </header>

      <dl className="run-headline">
        <div>
          <dt>Distance</dt>
          <dd>
            <Measure text={formatKm(run.distance as Metres)} />
          </dd>
        </div>
        <div>
          <dt>Moving time</dt>
          <dd>{formatDuration(run.moving as Seconds)}</dd>
        </div>
        <div>
          <dt>Average pace</dt>
          <dd>
            <Measure text={paceOf(run.distance, run.moving)} />
          </dd>
        </div>
      </dl>

      {metrics ? (
        <dl className="run-facts">
          {metrics.heartRate ? <Fact label="Heart rate" value={`${metrics.heartRate.average} avg · ${metrics.heartRate.max} max`} /> : null}
          {metrics.cadence ? <Fact label="Cadence" value={`${metrics.cadence} spm`} /> : null}
          {metrics.elevationGain !== null ? <Fact label="Climb" value={whole(metrics.elevationGain, 'm')} /> : null}
          <Fact label="Elapsed" value={formatDuration(metrics.elapsed)} />
          {metrics.calories ? <Fact label="Energy" value={whole(metrics.calories, 'kcal')} /> : null}
        </dl>
      ) : null}

      {syncing ? (
        <p className="run-syncing" role="status">
          <span className="run-syncing-dot" aria-hidden="true" />
          Splits and charts are still on their way from Strava. They usually arrive within 15 minutes.
        </p>
      ) : null}

      {charts ? (
        <section aria-labelledby="run-charts" className="run-section">
          <h2 id="run-charts">Over the run</h2>
          <TraceStack
            distance={charts.distance}
            traces={[
              ...(charts.heartRate ? [{ title: 'Heart rate', values: charts.heartRate, format: rounded, unit: 'bpm' }] : []),
              ...(charts.pace ? [{ title: 'Pace', values: charts.pace, format: minutes, unit: '/km', invert: true }] : []),
              ...(charts.cadence ? [{ title: 'Cadence', values: charts.cadence, format: rounded, unit: 'spm' }] : []),
              ...(charts.altitude ? [{ title: 'Elevation', values: charts.altitude, format: rounded, unit: 'm' }] : []),
            ]}
          />
        </section>
      ) : null}

      {zones && zoneTotal > 0 ? (
        <section aria-labelledby="run-zones" className="run-section">
          <h2 id="run-zones">Effort</h2>
          <ZoneBars zones={zones.zones} />
          <p className="member-note">
            Zones are estimated from {whose} highest recorded heart rate in the last 12 months ({zones.estimatedMaxHr} bpm), not a tested maximum.
          </p>
        </section>
      ) : null}

      {splits.length > 0 ? (
        <section aria-labelledby="run-splits" className="run-section">
          <h2 id="run-splits">Splits</h2>
          <div className="run-table-wrap">
            <table className="run-table run-splits">
              <thead>
                <tr>
                  <th scope="col">Km</th>
                  <th scope="col">Pace</th>
                  <th scope="col" className="run-split-bar-col">
                    <span className="visually-hidden">Relative speed</span>
                  </th>
                  <th scope="col">Heart rate</th>
                  <th scope="col">Elevation</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split) => {
                  const fastest = split.index === bars.fastestIndex
                  return (
                    <tr key={split.index} data-fastest={fastest || undefined}>
                      <th scope="row">{split.distance < FULL_SPLIT_METRES ? `+${Math.round(split.distance)} m` : split.index}</th>
                      <td>{paceOf(split.distance, split.moving)}</td>
                      <td className="run-split-bar-col">
                        {split.distance >= FULL_SPLIT_METRES ? (
                          <span className="run-split-bar" aria-hidden="true" style={{ inlineSize: `${(bars.widthOf(split) * 0.72).toFixed(1)}%` }} />
                        ) : null}
                        {fastest ? <span className="run-split-fastest">Fastest</span> : null}
                      </td>
                      <td>{whole(split.heartRate, 'bpm')}</td>
                      <td>{split.elevationDiff === null ? '–' : `${split.elevationDiff > 0 ? '+' : ''}${Math.round(split.elevationDiff)} m`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {laps.length > 1 ? (
        <section aria-labelledby="run-laps" className="run-section">
          <h2 id="run-laps">Laps</h2>
          <div className="run-table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th scope="col">Lap</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Time</th>
                  <th scope="col">Pace</th>
                  <th scope="col">Heart rate</th>
                  <th scope="col">Cadence</th>
                </tr>
              </thead>
              <tbody>
                {laps.map((lap) => (
                  <tr key={lap.index}>
                    <th scope="row">{lap.index}</th>
                    <td>{km(lap.distance)}</td>
                    <td>{formatDuration(lap.moving)}</td>
                    <td>{paceOf(lap.distance, lap.moving)}</td>
                    <td>{lap.heartRate ? `${lap.heartRate.average} bpm` : '–'}</td>
                    <td>{whole(lap.cadence, 'spm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {bestEfforts.length > 0 ? (
        <section aria-labelledby="run-efforts" className="run-section">
          <h2 id="run-efforts">Best efforts</h2>
          <div className="run-table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th scope="col">Distance</th>
                  <th scope="col">Time</th>
                  <th scope="col">Pace</th>
                </tr>
              </thead>
              <tbody>
                {bestEfforts.map((effort) => (
                  <tr key={effort.index}>
                    <th scope="row">
                      {effort.name}
                      {effort.prRank ? <span className="run-tag">{PR_LABELS[effort.prRank]}</span> : null}
                    </th>
                    <td>{formatDuration(effort.elapsed)}</td>
                    <td>{paceOf(effort.distance, effort.elapsed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!metrics && !syncing ? <p className="member-note">This run has no heart rate, cadence or split data. Runs synced from Strava show them here.</p> : null}
    </article>
  )
}

const PR_LABELS = { 1: 'Personal best', 2: '2nd best', 3: '3rd best' } as const
