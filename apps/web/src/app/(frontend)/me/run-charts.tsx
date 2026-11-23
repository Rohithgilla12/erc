import { formatDuration, type Seconds, type ZoneTime } from '@erc/domain'
import React from 'react'

export const km = (metres: number) => `${(metres / 1000).toFixed(metres < 1000 ? 2 : 1)} km`

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
export function LineChart({ title, distance, values, format, invert = false }: ChartProps) {
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

/** Time in each heart-rate zone as a share of the run's zoned time. */
export function ZoneBars({ zones }: { zones: readonly ZoneTime[] }) {
  const zoneTotal = zones.reduce((sum, zone) => sum + zone.seconds, 0)
  return (
    <ul className="run-zones">
      {zones.map((zone) => {
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
  )
}
