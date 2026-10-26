import { camRadius } from '../../core/design/hardware'
import type { Design, Hardware } from '../../core/design/schema'
import { MAX_FEET, MIN_FEET } from '../../core/design/schema'
import { gestureProps, updateDesign, useDesignStore } from '../../state/designStore'
import { useUnits } from '../../state/uiStore'
import { InfoTip } from '../common/InfoTip'
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
        info="How many feet the module has, each on its own cam. The cams are phased 360°/N apart so one foot is always down. More feet give less bob and gentler handoffs, but a longer stack."
        {...gestureProps}
      />
      <NumberField
        label="Eccentricity L"
        quantity="length"
        min={0.1}
        value={design.drive.L}
        slider={{ min: 1, max: 25 }}
        onChange={(L) => updateDesign((d) => ({ ...d, drive: { ...d.drive, L } }))}
        info="How far the cam disc centre (P1) is offset from the cam shaft (P0). More L gives a longer stride, and more bob."
        {...gestureProps}
      />
      <NumberField
        label="Pin height (y)"
        quantity="length"
        value={pin.y}
        slider={{ min: 10, max: 120 }}
        onChange={(y) => setPin({ y })}
        info="Height of the pin (the stationary shaft through every foot's slot) above the cam shaft. A lower pin tilts the feet more, which lengthens the stride. It must be further than L from the cam shaft."
        {...gestureProps}
      />
      <NumberField
        label="Pin offset (x)"
        quantity="length"
        value={pin.x}
        slider={{ min: -30, max: 30 }}
        onChange={(x) => setPin({ x })}
        info="Sideways position of the pin. Off-centre pins make the motion lopsided, which shows up as handoff slip."
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
        <span className={styles.rowLabel}>
          Shaft
          <InfoTip label="Shaft">The cam shaft's profile. A hex shaft is measured across its flats.</InfoTip>
        </span>
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
      <NumberField
        label="Pin diameter"
        quantity="length"
        min={0.5}
        value={h.pinDiameter}
        onChange={(pinDiameter) => setHardware({ pinDiameter })}
        info="Diameter of the stationary pin. The slot is this wide, plus the clearance on each side."
      />
      <NumberField
        label="Clearance"
        quantity="length"
        min={0}
        value={h.clearance}
        onChange={(clearance) => setHardware({ clearance })}
        info="Gap added around every bore and slot so the parts turn and slide freely."
      />
      <NumberField
        label="Minimum wall"
        quantity="length"
        min={0}
        value={h.minWall}
        onChange={(minWall) => setHardware({ minWall })}
        info="The thinnest material allowed around any hole. It is also the cam's margin around the shaft."
      />
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          Cam diameter (auto)
          <InfoTip label="Cam diameter">Sized automatically: just big enough to hold the shaft hole at offset L, with the minimum wall around it.</InfoTip>
        </span>
        <span className={styles.rowValue}>{formatLength(2 * camRadius(design), units)}</span>
      </div>
    </Section>
  )
}
