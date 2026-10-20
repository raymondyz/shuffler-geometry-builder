import { memo, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Kinematics } from '../../../core/analysis/analyze'
import { radToDeg, TAU } from '../../../core/math/angle'
import { shiftCurve1D } from '../../../core/spline/curve'
import { playheadActions, usePlayhead } from '../../../state/playhead'
import { useUiStore, useUnits, type ChartRange } from '../../../state/uiStore'
import { EmptyState } from '../../common/Panel'
import { SegmentedControl } from '../../common/SegmentedControl'
import { formatAngle, formatLength, formatNumber, fromDisplay, toDisplay, type Units } from '../../format'
import { useElementSize } from '../../hooks/useElementSize'
import { Legend } from '../../plot/Legend'
import { curve1DPath } from '../../plot/paths'
import { niceTicks, tickDecimals } from '../../plot/ticks'
import { footColor, footLabel } from '../palette'
import type { ViewProps } from '../types'
import styles from './HeightChart.module.css'

const MARGIN = { top: 12, right: 16, bottom: 42, left: 60 }

/** Maps chart data (φ radians, y mm) to pixels. */
interface Frame {
  width: number
  height: number
  yMin: number
  yMax: number
  x(phi: number): number
  y(mm: number): number
  /** SVG matrix that applies the same mapping to data-space paths */
  matrix: string
}

function makeFrame(width: number, height: number, yMin: number, yMax: number): Frame {
  const w = Math.max(10, width - MARGIN.left - MARGIN.right)
  const h = Math.max(10, height - MARGIN.top - MARGIN.bottom)
  const sx = w / TAU
  const ky = h / (yMax - yMin)
  return {
    width: w,
    height: h,
    yMin,
    yMax,
    x: (phi) => MARGIN.left + phi * sx,
    y: (mm) => MARGIN.top + (yMax - mm) * ky,
    matrix: `matrix(${sx} 0 0 ${-ky} ${MARGIN.left} ${MARGIN.top + yMax * ky})`,
  }
}

function yRange(k: Kinematics, range: ChartRange): [number, number] {
  const { minY, maxY } = k.envelope
  if (range === 'envelope') {
    const pad = Math.max(0.25 * (maxY - minY), 0.2)
    return [minY - pad, maxY + pad]
  }
  const top = Math.max(...k.curves.height.pieces.flatMap((p) => [p.v0, p.v1]))
  const pad = 0.06 * (top - minY || 1)
  return [minY - pad, top + pad]
}

/** Grid, axes and tick labels. */
function Axes({ frame, units }: { frame: Frame; units: Units }) {
  const yTicksShown = niceTicks(toDisplay(frame.yMin, units), toDisplay(frame.yMax, units), Math.max(2, Math.round(frame.height / 50)))
  const decimals = tickDecimals(yTicksShown)
  const xTicks = Array.from({ length: 9 }, (_, i) => (i * TAU) / 8)
  const bottom = MARGIN.top + frame.height
  return (
    <g className={styles.axes}>
      {yTicksShown.map((t) => {
        const y = frame.y(fromDisplay(t, units))
        return (
          <g key={t}>
            <line x1={MARGIN.left} x2={MARGIN.left + frame.width} y1={y} y2={y} className={styles.grid} />
            <text x={MARGIN.left - 6} y={y} dy="0.32em" textAnchor="end" className={styles.tick}>{formatNumber(t, decimals)}</text>
          </g>
        )
      })}
      {xTicks.map((phi) => (
        <g key={phi}>
          <line x1={frame.x(phi)} x2={frame.x(phi)} y1={MARGIN.top} y2={bottom} className={styles.grid} />
          <text x={frame.x(phi)} y={bottom + 16} textAnchor="middle" className={styles.tick}>{formatNumber(radToDeg(phi), 0)}°</text>
        </g>
      ))}
      <line x1={MARGIN.left} x2={MARGIN.left + frame.width} y1={bottom} y2={bottom} className={styles.baseline} />
      <text x={MARGIN.left + frame.width / 2} y={bottom + 32} textAnchor="middle" className={styles.axisLabel}>
        Cam angle φ of foot 1 (°)
      </text>
      <text
        transform={`translate(14 ${MARGIN.top + frame.height / 2}) rotate(-90)`}
        textAnchor="middle"
        className={styles.axisLabel}
      >
        Lowest point y ({units})
      </text>
    </g>
  )
}

/** Feet curves, envelope, bob lines and handoff markers: everything that is static for a design. */
const DataLayer = memo(function DataLayer({ k, frame, clipId, units }: { k: Kinematics; frame: Frame; clipId: string; units: Units }) {
  const { feet, period, envelope } = k
  const footPath = curve1DPath(k.curves.height)
  const footPathNext = curve1DPath(useMemo(() => shiftCurve1D(k.curves.height, TAU), [k.curves.height]))
  const envelopePath = curve1DPath(envelope.height)
  const copies = Array.from({ length: feet + 2 }, (_, i) => i - 1)
  const handoffs = copies.flatMap((m) => envelope.handoffs.map((h) => ({ phi: h.phi + m * period, y: k.envelopeAt(h.phi).y })))
    .filter((h) => h.phi >= 0 && h.phi <= TAU)
  const bobLabelY = frame.y(envelope.maxY)
  return (
    <g>
      <g clipPath={`url(#${clipId})`}>
        <g transform={frame.matrix}>
          <line x1={0} x2={TAU} y1={envelope.minY} y2={envelope.minY} className={styles.bobLine} />
          <line x1={0} x2={TAU} y1={envelope.maxY} y2={envelope.maxY} className={styles.bobLine} />
          {copies.map((m) => (
            <path key={m} d={envelopePath} transform={`translate(${m * period} 0)`} className={styles.envelope} />
          ))}
          {Array.from({ length: feet }, (_, f) => (
            <g key={f} transform={`translate(${-f * period} 0)`} style={{ stroke: footColor(f) }} className={styles.foot}>
              <path d={footPath} />
              <path d={footPathNext} />
            </g>
          ))}
        </g>
        {handoffs.map((h, i) => (
          <circle key={i} cx={frame.x(h.phi)} cy={frame.y(h.y)} r={4} className={styles.handoff} />
        ))}
      </g>
      <text x={MARGIN.left + frame.width - 4} y={bobLabelY - 6} textAnchor="end" className={styles.bobLabel}>
        bob {formatLength(envelope.maxY - envelope.minY, units)}
      </text>
    </g>
  )
})

function Playhead({ k, frame }: { k: Kinematics; frame: Frame }) {
  const phi = usePlayhead((s) => s.phi)
  const x = frame.x(phi)
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={MARGIN.top} y2={MARGIN.top + frame.height} className={styles.playhead} />
      <circle cx={x} cy={frame.y(k.envelopeAt(phi).y)} r={4.5} className={styles.playheadDot} />
    </g>
  )
}

interface HoverState {
  phi: number
  px: number
  py: number
}

function HoverReadout({ k, frame, hover, units }: { k: Kinematics; frame: Frame; hover: HoverState; units: Units }) {
  const ys = Array.from({ length: k.feet }, (_, f) => k.model.sample(hover.phi + f * k.period).y)
  const ground = k.envelopeAt(hover.phi)
  const flip = hover.px > MARGIN.left + frame.width * 0.6
  return (
    <>
      <svg className={styles.overlaySvg} aria-hidden="true">
        <line x1={hover.px} x2={hover.px} y1={MARGIN.top} y2={MARGIN.top + frame.height} className={styles.crosshair} />
      </svg>
      <div className={styles.tooltip} style={{ left: flip ? undefined : hover.px + 12, right: flip ? `calc(100% - ${hover.px - 12}px)` : undefined, top: MARGIN.top + 4 }}>
        <div className={styles.tooltipTitle}>φ {formatAngle(hover.phi)}</div>
        {ys.map((y, f) => (
          <div key={f} className={styles.tooltipRow}>
            <span className={styles.key} style={{ background: footColor(f) }} />
            <span>{footLabel(f)}{f === ground.foot ? ' (stance)' : ''}</span>
            <span className={styles.value}>{formatLength(y, units)}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Header legend (one entry per foot) and the vertical range toggle. */
export function HeightChartActions({ analysis }: ViewProps) {
  const range = useUiStore((s) => s.chartRange)
  const setPreference = useUiStore((s) => s.setPreference)
  const feet = analysis.kinematics?.feet ?? 0
  return (
    <>
      <Legend
        entries={[
          ...Array.from({ length: feet }, (_, f) => ({ label: footLabel(f), color: footColor(f) })),
          { label: 'Envelope (robot bob)', color: 'var(--envelope)', width: 6 },
        ]}
      />
      <SegmentedControl<ChartRange>
        label="Vertical range"
        value={range}
        onChange={(v) => setPreference('chartRange', v)}
        options={[
          { value: 'full', label: 'Full', title: 'Show the full foot lift' },
          { value: 'envelope', label: 'Bob', title: 'Zoom to the envelope (robot bob)' },
        ]}
      />
    </>
  )
}

export function HeightChart({ analysis }: ViewProps) {
  const k = analysis.kinematics
  const units = useUnits()
  const range = useUiStore((s) => s.chartRange)
  const ref = useRef<HTMLDivElement>(null)
  const size = useElementSize(ref)
  const clipId = useId()
  const [hover, setHover] = useState<HoverState | null>(null)
  const dragging = useRef(false)

  const frame = useMemo(() => {
    if (!k) return null
    const [yMin, yMax] = yRange(k, range)
    return makeFrame(size.width, size.height, yMin, yMax)
  }, [k, range, size.width, size.height])

  const phiAt = (e: ReactPointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const phi = Math.min(TAU, Math.max(0, ((px - MARGIN.left) / (frame?.width ?? 1)) * TAU))
    return { phi, px: frame?.x(phi) ?? px, py: e.clientY - rect.top }
  }

  return (
    <>
      <div
        ref={ref}
        className={styles.chart}
        onPointerDown={(e) => {
          if (!frame) return
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          playheadActions.scrubTo(phiAt(e).phi)
        }}
        onPointerMove={(e) => {
          if (!frame) return
          const p = phiAt(e)
          if (dragging.current) playheadActions.scrubTo(p.phi)
          if (e.pointerType === 'mouse') setHover(p)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onPointerLeave={() => setHover(null)}
      >
        {!k || !frame ? (
          <EmptyState>Fix the errors listed in the sidebar to see foot heights.</EmptyState>
        ) : (
          <>
            <svg className={styles.svg} role="img" aria-label="Height of each foot's lowest point against cam angle; the lower envelope is the robot's bob">
              <defs>
                <clipPath id={clipId}>
                  <rect x={MARGIN.left} y={MARGIN.top} width={frame.width} height={frame.height} />
                </clipPath>
              </defs>
              <Axes frame={frame} units={units} />
              <DataLayer k={k} frame={frame} clipId={clipId} units={units} />
              <Playhead k={k} frame={frame} />
            </svg>
            {hover && <HoverReadout k={k} frame={frame} hover={hover} units={units} />}
          </>
        )}
      </div>
    </>
  )
}
