import type { GoalInfo, GoalMode, GoalSetting, Importance } from '../../core/generate/brief'
import { InfoTip } from '../common/InfoTip'
import { NumberField } from '../common/NumberField'
import { SegmentedControl } from '../common/SegmentedControl'
import styles from './generate.module.css'

interface GoalRowProps {
  info: GoalInfo
  setting: GoalSetting
  onChange(setting: GoalSetting): void
}

const MODES: { value: GoalMode; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'Not considered' },
  { value: 'limit', label: 'Limit', title: 'A hard requirement' },
  { value: 'goal', label: 'Goal', title: 'Aim for an ideal value; anything up to the acceptable value is fine' },
]

const IMPORTANCE: { value: `${Importance}`; label: string }[] = [
  { value: '1', label: 'Low' },
  { value: '2', label: 'Normal' },
  { value: '4', label: 'High' },
]

/** One metric's role in the brief: off, a hard limit, or a goal with ideal/acceptable values and an importance. */
export function GoalRow({ info, setting, onChange }: GoalRowProps) {
  const set = (patch: Partial<GoalSetting>) => onChange({ ...setting, ...patch })
  const lower = info.better === 'lower'
  const quantity = info.quantity
  return (
    <div className={[styles.goal, setting.mode === 'off' ? styles.goalOff : ''].join(' ')}>
      <div className={styles.itemHead}>
        <span className={styles.itemLabel}>
          {info.label}
          <InfoTip label={info.label}>{info.description}</InfoTip>
        </span>
        <div className={styles.small}>
          <SegmentedControl label={`${info.label}: off, limit or goal`} value={setting.mode} onChange={(mode) => set({ mode })} options={MODES} />
        </div>
      </div>
      {setting.mode === 'limit' && (
        <NumberField label={lower ? 'At most' : 'At least'} quantity={quantity} min={0} value={setting.limit} onChange={(limit) => set({ limit })} />
      )}
      {setting.mode === 'goal' && (
        <>
          <div className={styles.pair}>
            <NumberField label="Ideal" layout="stacked" quantity={quantity} min={0} value={setting.ideal} onChange={(ideal) => set({ ideal })} />
            <NumberField
              label={lower ? 'Acceptable up to' : 'Acceptable from'}
              layout="stacked"
              quantity={quantity}
              min={0}
              value={setting.acceptable}
              onChange={(acceptable) => set({ acceptable })}
            />
          </div>
          <div className={styles.itemHead}>
            <span className={styles.itemLabel}>Importance</span>
            <div className={styles.small}>
              <SegmentedControl
                label={`${info.label} importance`}
                value={`${setting.importance}`}
                onChange={(v) => set({ importance: Number(v) as Importance })}
                options={IMPORTANCE}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
