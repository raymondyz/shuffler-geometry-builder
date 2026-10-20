import styles from './plot.module.css'

export interface LegendEntry {
  label: string
  color: string
  kind?: 'line' | 'dashed' | 'band' | 'dot'
  width?: number
}

function Swatch({ color, kind = 'line', width = 2 }: Omit<LegendEntry, 'label'>) {
  return (
    <svg width={18} height={10} aria-hidden="true">
      {kind === 'dot' && <circle cx={9} cy={5} r={4} fill={color} />}
      {kind === 'band' && <rect x={1} y={1} width={16} height={8} rx={2} fill={color} opacity={0.35} />}
      {(kind === 'line' || kind === 'dashed') && (
        <line x1={1} y1={5} x2={17} y2={5} stroke={color} strokeWidth={width} strokeLinecap="round" strokeDasharray={kind === 'dashed' ? '3 3' : undefined} />
      )}
    </svg>
  )
}

/** Inline legend: a colour key beside each text label (text stays in text colours). */
export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className={styles.legend}>
      {entries.map((e) => (
        <span key={e.label} className={styles.legendItem}>
          <Swatch color={e.color} kind={e.kind} width={e.width} />
          {e.label}
        </span>
      ))}
    </div>
  )
}
