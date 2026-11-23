import { describe, expect, it } from 'vitest'

import { downsampleStreams, timeInZones, type Bpm, type RunStreams } from './run-metrics'

const streams = (length: number, overrides: Partial<RunStreams> = {}): RunStreams => ({
  time: Array.from({ length }, (_, i) => i),
  distance: Array.from({ length }, (_, i) => i * 3),
  heartRate: null,
  cadence: null,
  velocity: null,
  altitude: null,
  ...overrides,
})

describe('downsampleStreams', () => {
  it('averages equal runs of samples into at most maxPoints points', () => {
    const series = downsampleStreams(streams(10, { heartRate: [100, 102, 110, 112, 120, 122, 130, 132, 140, 142] }), 5)
    expect(series.distance).toEqual([1.5, 7.5, 13.5, 19.5, 25.5])
    expect(series.heartRate).toEqual([101, 111, 121, 131, 141])
    expect(series.pace).toBeNull()
  })

  it('keeps every sample when there are fewer than maxPoints', () => {
    expect(downsampleStreams(streams(3), 300).distance).toEqual([0, 3, 6])
  })

  it('turns speed into seconds per km and leaves stops as gaps', () => {
    const series = downsampleStreams(streams(2, { velocity: [4, 0.2] }), 2)
    expect(series.pace).toEqual([250, null])
  })
})

describe('timeInZones', () => {
  const max = 200 as Bpm

  it('credits each interval to the zone of its starting heart rate', () => {
    const zones = timeInZones([0, 10, 20, 30, 40], [110, 130, 150, 170, 190], max)
    expect(zones.map((z) => z.seconds)).toEqual([10, 10, 10, 10, 0])
    expect(zones.map((z) => [z.fromBpm, z.toBpm])).toEqual([
      [0, 120],
      [120, 140],
      [140, 160],
      [160, 180],
      [180, null],
    ])
  })

  it('skips pauses and missing samples', () => {
    const zones = timeInZones([0, 5, 300, 305], [185, 185, 0, 185], max)
    expect(zones.at(-1)?.seconds).toBe(5)
    expect(zones.reduce((sum, z) => sum + z.seconds, 0)).toBe(5)
  })
})
