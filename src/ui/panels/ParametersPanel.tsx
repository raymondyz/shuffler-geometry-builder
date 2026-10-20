import { camRadius } from '../../core/design/hardware'
import type { Design, Hardware } from '../../core/design/schema'
import { MAX_FEET, MIN_FEET } from '../../core/design/schema'
import { gestureProps, updateDesign, useDesignStore } from '../../state/designStore'
import { useUnits } from '../../state/uiStore'
import { NumberField } from '../common/NumberField'
import { Section } from '../common/Section'
import { SegmentedControl } from '../common/SegmentedControl'
import { formatLength } from '../format'
import styles from './panels.module.css'

const setHardware = (patch: Partial<Hardware>) => updateDesign((d) => ({ ...d, hardware: { ...d.hardware, ...patch } }))

const setPin = (patch: Partial<Design['constraint']['pin']>) =>
  updateDesign((d) => ({ ...d, constraint: { ...d.constraint, pin: { ...d.constraint.pin, ...patch } } }))

export function MechanismSection() {
  const design = useDesignStore((s) => s.design)
  const { pin } = design.constraint
  return (
    <Section title="Mechanism">
      <NumberField
        label="Feet"
        integer
        min={MIN_FEET}
        max={MAX_FEET}
        value={design.feet.count}
        slider={{ min: MIN_FEET, max: MAX_FEET }}
        onChange={(count) => updateDesign((d) => ({ ...d, feet: { count } }))}
        title="Number of cams and feet, phased 360°/N apart"
        {...gestureProps}
      />
      <NumberField
        label="Eccentricity L"
        quantity="length"
        min={0.1}
        value={design.drive.L}
        slider={{ min: 1, max: 25 }}
        onChange={(L) => updateDesign((d) => ({ ...d, drive: { ...d.drive, L } }))}
        title="Offset between the cam shaft P0 and the cam disc centre P1"
        {...gestureProps}
      />
      <NumberField
        label="Pin height (y)"
        quantity="length"
        value={pin.y}
        slider={{ min: 10, max: 120 }}
        onChange={(y) => setPin({ y })}
        title="Stationary shaft position above the cam shaft"
        {...gestureProps}
      />
      <NumberField
        label="Pin offset (x)"
        quantity="length"
        value={pin.x}
        slider={{ min: -30, max: 30 }}
        onChange={(x) => setPin({ x })}
        title="Stationary shaft position to the side of the cam shaft"
        {...gestureProps}
      />
    </Section>
  )
}

export function HardwareSection() {
  const design = useDesignStore((s) => s.design)
  const units = useUnits()
  const h = design.hardware
  return (
    <Section title="Hardware" defaultOpen={false}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>Shaft</span>
        <SegmentedControl
          label="Shaft type"
          value={h.shaft.kind}
          onChange={(kind) => setHardware({ shaft: { ...h.shaft, kind } })}
          options={[
            { value: 'hex', label: 'Hex' },
            { value: 'round', label: 'Round' },
          ]}
        />
      </div>
      <NumberField
        label={h.shaft.kind === 'hex' ? 'Shaft across flats' : 'Shaft diameter'}
        quantity="length"
        min={0.5}
        value={h.shaft.size}
        onChange={(size) => setHardware({ shaft: { ...h.shaft, size } })}
      />
      <NumberField label="Pin diameter" quantity="length" min={0.5} value={h.pinDiameter} onChange={(pinDiameter) => setHardware({ pinDiameter })} />
      <NumberField label="Clearance" quantity="length" min={0} value={h.clearance} onChange={(clearance) => setHardware({ clearance })} title="Radial clearance added to every bore and slot" />
      <NumberField
        label="Minimum wall"
        quantity="length"
        min={0}
        value={h.minWall}
        onChange={(minWall) => setHardware({ minWall })}
        title="Minimum material around every hole; also the cam's margin around the shaft"
      />
      <div className={styles.row} title="Sized automatically: eccentricity L + shaft hole + minimum wall">
        <span className={styles.rowLabel}>Cam diameter (auto)</span>
        <span className={styles.rowValue}>{formatLength(2 * camRadius(design), units)}</span>
      </div>
    </Section>
  )
}
