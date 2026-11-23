import type { RunDetailView } from '@erc/contract'
import { CLUB_TIME_ZONE, formatDuration, formatKm, type Metres, type Seconds, type WorkoutType } from '@erc/domain'
import React from 'react'

const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CLUB_TIME_ZONE })

const pace = (secondsPerKm: number) => `${formatDuration(Math.round(secondsPerKm) as Seconds)} /km`
const paceOf = (metres: number, seconds: number) => (metres > 0 ? pace(seconds / (metres / 1000)) : '–')
const whole = (value: number | null, unit: string) => (value === null ? '–' : `${Math.round(value)} ${unit}`)
const km = (metres: number) => `${(metres / 1000).toFixed(metres < 1000 ? 2 : 1)} km`

const WORKOUT_LABELS: Record<WorkoutType, string> = { default: 'Run', race: 'Race', long: 'Long run', workout: 'Workout' }

const CHART_W = 600
const CHART_H = 140

/** An SVG path through the points, starting a new segment after each gap so a stop is not drawn as a ramp. */
const pathOf = (xs: readonly number[], ys: readonly (number | null)[], invert: boolean) => {
  const values = ys.filter((y): y is number => y !== null)
  const xMax = xs.at(-1) || 1
  const [low, high] = [Math.min(...values), Math.max(...values)]
  const span = high - low || 1
  const pad = span * 0.08
  const yOf = (y: number) => {
    const t = (y - (low - pad)) / (span + 2 * pad)
    return (invert ? t : 1 - t) * CHART_H
  }
  let path = ''
  let pen = false
  ys.forEach((y, i) => {
    if (y === null) {
      pen = false
      return
    }
    path += `${pen ? 'L' : 'M'}${(((xs[i] ?? 0) / xMax) * CHART_W).toFixed(1)} ${yOf(y).toFixed(1)}`
    pen = true
  })
  return { path, low, high }
}

type ChartProps = { title: string; distance: readonly number[]; values: readonly (number | null)[]; format: (value: number) => string; invert?: boolean }

/** Server-drawn, so it renders without JavaScript. Faster pace plots higher, as runners read it. */
function LineChart({ title, distance, values, format, invert = false }: ChartProps) {
  if (!values.some((value) => value !== null)) return null
  const { path, low, high } = pathOf(distance, values, invert)
  const total = km(distance.at(-1) ?? 0)
  const [top, bottom] = invert ? [low, high] : [high, low]
  return (
    <figure className="run-chart">
      <figcaption className="run-chart-title">{title}</figcaption>
      <div className="run-chart-frame">
        <span className="run-chart-axis run-chart-axis--top">{format(top)}</span>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" role="img" aria-label={`${title}: from ${format(low)} to ${format(high)} over ${total}`}>
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <span className="run-chart-axis run-chart-axis--bottom">{format(bottom)}</span>
      </div>
      <div className="run-chart-x">
        <span>0 km</span>
        <span>{total}</span>
      </div>
    </figure>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

type Props = { detail: RunDetailView; viewer: 'self' | 'coach' }

export function RunDetailBody({ detail, viewer }: Props) {
  const { run, metrics, splits, laps, bestEfforts, charts, zones, syncing } = detail
  const zoneTotal = zones ? zones.zones.reduce((sum, zone) => sum + zone.seconds, 0) : 0
  const whose = viewer === 'self' ? 'your' : "the athlete's"

  return (
    <article className="run-detail">
      <header>
        <p className="member-lede">
          <time dateTime={run.on}>{day.format(new Date(`${run.on}T00:00:00Z`))}</time>
          {metrics ? `, ${clock.format(new Date(metrics.startAt))} IST` : null}
          {run.source === 'strava' ? ' · from Strava' : null}
          {metrics?.workoutType && metrics.workoutType !== 'default' ? ` · ${WORKOUT_LABELS[metrics.workoutType]}` : null}
        </p>
        <h1>{run.note ?? 'Run'}</h1>
      </header>

      {syncing ? (
        <p className="member-note run-syncing" role="status">
          Details are still syncing from Strava. Splits and charts appear within about 15 minutes.
        </p>
      ) : null}

      <dl className="run-stats">
        <Stat label="Distance" value={formatKm(run.distance as Metres)} />
        <Stat label="Moving time" value={formatDuration(run.moving as Seconds)} />
        <Stat label="Average pace" value={paceOf(run.distance, run.moving)} />
        {metrics ? <Stat label="Elapsed time" value={formatDuration(metrics.elapsed)} /> : null}
        {metrics?.heartRate ? <Stat label="Heart rate" value={`${metrics.heartRate.average} avg, ${metrics.heartRate.max} max`} /> : null}
        {metrics?.cadence ? <Stat label="Cadence" value={`${metrics.cadence} spm`} /> : null}
        {metrics?.elevationGain !== null && metrics?.elevationGain !== undefined ? <Stat label="Elevation gain" value={whole(metrics.elevationGain, 'm')} /> : null}
        {metrics?.calories ? <Stat label="Calories" value={whole(metrics.calories, 'kcal')} /> : null}
        {metrics?.deviceName ? <Stat label="Recorded with" value={metrics.deviceName} /> : null}
      </dl>

      {charts ? (
        <section aria-labelledby="run-charts" className="run-section">
          <h2 id="run-charts">Over the run</h2>
          <div className="run-charts">
            {charts.heartRate ? <LineChart title="Heart rate" distance={charts.distance} values={charts.heartRate} format={(v) => `${Math.round(v)} bpm`} /> : null}
            {charts.pace ? <LineChart title="Pace" distance={charts.distance} values={charts.pace} format={pace} invert /> : null}
            {charts.cadence ? <LineChart title="Cadence" distance={charts.distance} values={charts.cadence} format={(v) => `${Math.round(v)} spm`} /> : null}
            {charts.altitude ? <LineChart title="Elevation" distance={charts.distance} values={charts.altitude} format={(v) => `${Math.round(v)} m`} /> : null}
          </div>
        </section>
      ) : null}

      {zones && zoneTotal > 0 ? (
        <section aria-labelledby="run-zones" className="run-section">
          <h2 id="run-zones">Time in heart-rate zones</h2>
          <p className="member-note">
            An estimate. Zones are shares of a maximum heart rate of {zones.estimatedMaxHr} bpm, {whose} highest recorded maximum in the last 12 months, not
            a tested maximum.
          </p>
          <ul className="run-zones">
            {zones.zones.map((zone) => {
              const share = zone.seconds / zoneTotal
              return (
                <li key={zone.zone} className="run-zone">
                  <span className="run-zone-label">
                    Zone {zone.zone} <span className="member-run-detail">{zone.toBpm === null ? `${zone.fromBpm}+ bpm` : `${zone.fromBpm}–${zone.toBpm - 1} bpm`}</span>
                  </span>
                  <span className="run-zone-bar" aria-hidden="true">
                    <span style={{ inlineSize: `${(share * 100).toFixed(1)}%` }} data-zone={zone.zone} />
                  </span>
                  <span className="run-zone-time">
                    {formatDuration(Math.round(zone.seconds) as Seconds)} ({Math.round(share * 100)}%)
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {splits.length > 0 ? (
        <section aria-labelledby="run-splits" className="run-section">
          <h2 id="run-splits">Splits</h2>
          <div className="run-table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th scope="col">Km</th>
                  <th scope="col">Pace</th>
                  <th scope="col">Time</th>
                  <th scope="col">Heart rate</th>
                  <th scope="col">Elevation</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((split) => (
                  <tr key={split.index}>
                    <th scope="row">{split.distance < 950 ? (split.distance / 1000).toFixed(2) : split.index}</th>
                    <td>{paceOf(split.distance, split.moving)}</td>
                    <td>{formatDuration(split.moving)}</td>
                    <td>{whole(split.heartRate, 'bpm')}</td>
                    <td>{split.elevationDiff === null ? '–' : `${split.elevationDiff > 0 ? '+' : ''}${Math.round(split.elevationDiff)} m`}</td>
                  </tr>
                ))}
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
          <ul className="member-runs">
            {bestEfforts.map((effort) => (
              <li key={effort.index} className="member-run">
                <span>{effort.name}</span>
                <span>{formatDuration(effort.elapsed)}</span>
                <span className="member-run-detail">
                  {paceOf(effort.distance, effort.elapsed)}
                  {effort.prRank === 1 ? ', personal best' : effort.prRank ? `, ${effort.prRank === 2 ? '2nd' : '3rd'} best` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!metrics && !syncing ? <p className="member-note">This run has no heart rate, cadence or split data. Runs synced from Strava show them here.</p> : null}
    </article>
  )
}
