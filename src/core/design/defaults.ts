import { symmetrize } from './mirror'
import { arcFootOutline, presetContext } from './presets'
import { DEFAULT_NAME, SCHEMA_VERSION, type Design } from './schema'

/** The SPEC §9 worked example: N = 3, L = 6, pin 40 mm above the shaft, arc foot R = 50, mirrored. */
export function createDefaultDesign(): Design {
  const base: Design = {
    schemaVersion: SCHEMA_VERSION,
    name: DEFAULT_NAME,
    units: 'mm',
    feet: { count: 3 },
    drive: { kind: 'eccentric', L: 6 },
    constraint: { kind: 'centerlineSlot', pin: { x: 0, y: 40 } },
    foot: { outline: { nodes: [], edges: [] }, mirror: true },
    hardware: {
      shaft: { kind: 'hex', size: 8 },
      pinDiameter: 5,
      clearance: 0.2,
      minWall: 2,
    },
    operating: { shaftRpm: 600 },
  }
  const outline = arcFootOutline(presetContext(base), 50, 70)
  const mirrored = symmetrize(outline)
  return { ...base, foot: { outline: mirrored ?? outline, mirror: mirrored !== null } }
}
