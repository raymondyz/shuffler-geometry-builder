import type { Drive } from '../drive'
import { centerlineSlotFactory, type CenterlineSlotSpec } from './centerlineSlot'
import type { ConstraintFactory, TiltConstraint } from './types'

/** Union of every serialisable constraint spec. Add new slot geometries here. */
export type ConstraintSpec = CenterlineSlotSpec

type FactoryMap = { [K in ConstraintSpec['kind']]: ConstraintFactory<Extract<ConstraintSpec, { kind: K }>> }

const factories: FactoryMap = {
  centerlineSlot: centerlineSlotFactory,
}

export const constraintKinds = Object.values(factories).map(({ kind, label, description }) => ({ kind, label, description }))

export function createConstraint(spec: ConstraintSpec, drive: Drive): TiltConstraint {
  const factory = factories[spec.kind] as ConstraintFactory<ConstraintSpec>
  return factory.create(spec, drive)
}
