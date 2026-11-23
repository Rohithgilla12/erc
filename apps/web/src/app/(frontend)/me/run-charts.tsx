import { formatDuration, type Seconds, type ZoneTime } from '@erc/domain'
import React from 'react'

export const km = (metres: number) => `${(metres / 1000).toFixed(metres < 1000 ? 2 : 1)} km`

const PLOT_W = 1000
const PLOT_H = 100

type Point = readonly [x: number, y: number]

/** Splits a series at its gaps, so a stop is drawn as a break rather than a ramp. */
function segmentsOf(xs: readonly number[], ys: readonly (number | null)[]): Point[][] {
  const segments: Point[][] = []
  let current: Point[] = []
  ys.forEach((y, i) => {
    if (y === null) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    current.push([xs[i] ?? 0, y])
  })
  if (current.length > 0) segments.push(current)
  return segments
}

function pathsOf(xs: readonly number[], ys: readonly (number | null)[], invert: boolean) {
  const values = ys.filter((y): y is number => y !== null)
  const xMax = xs.at(-1) || 1
  const [low, high] = [Math.min(...values), Math.max(...values)]
  const pad = (high - low || 1) * 0.12
  const yOf = (y: number) => {
    const t = (y - (low - pad)) / (high - low + 2 * pad)
    return ((invert ? t : 1 - t) * PLOT_H).toFixed(1)
  }
  const xOf = (x: number) => ((x / xMax) * PLOT_W).toFixed(1)
  let line = ''
  let area = ''
  for (const segment of segmentsOf(xs, ys)) {
    const points = segment.map(([x, y]) => `${xOf(x)} ${yOf(y)}`)
    line += `M${points.join('L')}`
    area += `M${xOf(segment[0]![0])} ${PLOT_H}L${points.join('L')}L${xOf(segment.at(-1)![0])} ${PLOT_H}Z`
  }
  return { line, area, low, high }
}

/** Kilometre marks for the shared axis: every km on short runs, thinning out so labels never crowd. */
function kmTicks(totalMetres: number): number[] {
  const totalKm = totalMetres / 1000
  const step = [1, 2, 5, 10, 20].find((candidate) => totalKm / candidate <= 10) ?? 50
  const ticks: number[] = []
  for (let mark = step; mark < totalKm - step * 0.4; mark += step) ticks.push(mark * 1000)
  return ticks
}

export type Trace = {
  title: string
  values: readonly (number | null)[]
  /** Formats a bare number; `unit` follows it once, so ranges read "125–177 bpm". */
  format: (value: number) => string
  unit: string
  /** Plot lower values higher, so faster pace reads as up. */
  invert?: boolean
}

/**
 * Every trace over the same distance axis, stacked like ruled lines in a notebook, so a coach can read a heart-rate
 * rise against the pace and the hill underneath it. Server-drawn, so it works without JavaScript.
 */
export function TraceStack({ distance, traces }: { distance: readonly number[]; traces: readonly Trace[] }) {
  const drawn = traces.filter((trace) => trace.values.some((value) => value !== null))
  if (drawn.length === 0) return null
  const total = distance.at(-1) ?? 0
  const ticks = kmTicks(total)
  const xPercent = (metres: number) => `${((metres / (total || 1)) * 100).toFixed(2)}%`

  return (
    <div className="run-traces">
      {drawn.map((trace) => {
        const { line, area, low, high } = pathsOf(distance, trace.values, trace.invert ?? false)
        const [best, worst] = trace.invert ? [low, high] : [high, low]
        return (
          <figure key={trace.title} className="run-trace">
            <figcaption className="run-trace-label">
              <span className="run-trace-title">{trace.title}</span>
              <span className="run-trace-range">
                {trace.format(worst)}–{trace.format(best)} {trace.unit}
              </span>
            </figcaption>
            <div className="run-trace-plot">
              <svg
                viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${trace.title} from ${trace.format(worst)} to ${trace.format(best)} ${trace.unit} over ${km(total)}`}
              >
                {ticks.map((tick) => (
                  <line key={tick} className="run-trace-rule" x1={(tick / total) * PLOT_W} x2={(tick / total) * PLOT_W} y1="0" y2={PLOT_H} vectorEffect="non-scaling-stroke" />
                ))}
                <path className="run-trace-area" d={area} />
                <path className="run-trace-line" d={line} vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          </figure>
        )
      })}
      <div className="run-trace-axis" aria-hidden="true">
        <span className="run-trace-label" />
        <span className="run-trace-ticks">
          <span style={{ insetInlineStart: '0%' }}>0</span>
          {ticks.map((tick) => (
            <span key={tick} style={{ insetInlineStart: xPercent(tick) }}>
              {tick / 1000}
            </span>
          ))}
          <span className="run-trace-end">{km(total)}</span>
        </span>
      </div>
    </div>
  )
}

const ZONE_NAMES: Record<ZoneTime['zone'], string> = { 1: 'Recovery', 2: 'Easy', 3: 'Steady', 4: 'Threshold', 5: 'Maximum' }

/** Time in each heart-rate zone: one bar for the shape of the run, then a legend that carries the numbers. */
export function ZoneBars({ zones }: { zones: readonly ZoneTime[] }) {
  const zoneTotal = zones.reduce((sum, zone) => sum + zone.seconds, 0)
  const share = (zone: ZoneTime) => zone.seconds / zoneTotal
  return (
    <div className="run-zones">
      <div className="run-zone-strip" aria-hidden="true">
        {zones
          .filter((zone) => zone.seconds > 0)
          .map((zone) => (
            <span key={zone.zone} data-zone={zone.zone} style={{ flexGrow: zone.seconds }} />
          ))}
      </div>
      <table className="run-zone-legend">
        <tbody>
          {zones.map((zone) => (
            <tr key={zone.zone} data-empty={zone.seconds === 0 || undefined}>
              <th scope="row">
                <span className="run-zone-swatch" data-zone={zone.zone} aria-hidden="true" />
                Zone {zone.zone} <span className="run-zone-name">{ZONE_NAMES[zone.zone]}</span>
              </th>
              <td className="run-zone-bpm">{zone.toBpm === null ? `${zone.fromBpm}+ bpm` : `${zone.fromBpm}–${zone.toBpm - 1} bpm`}</td>
              <td>{formatDuration(Math.round(zone.seconds) as Seconds)}</td>
              <td className="run-zone-share">{Math.round(share(zone) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
