# Shuffler Geometry Builder

A web tool for designing the geometry of **single-cam, pivoting-foot shuffler drives** for combat robots. Change the mechanism or draw the foot, and the bob, stride and smoothness results update live. Export the parts to CAD when you're done.

The math, design decisions and architecture are in [docs/SPEC.md](docs/SPEC.md).

## Running

```bash
npm install
npm run dev        # start the app at http://localhost:5173
npm test           # core tests: math, design, mirror, export (vitest)
npm run typecheck  # TypeScript only
npm run lint       # oxlint (also keeps src/core free of React and app state)
npm run build      # type-check and build to dist/
```

## Using it

- **Mechanism** (sidebar): number of feet, eccentricity L and the stationary shaft (pin) position. Shaft and pin sizes are under **Hardware**. The cam disc sizes itself to fit the shaft, using the minimum wall as its margin.
- **Results** (sidebar): bob and stride per revolution up top, with handoff kink and speed ripple for smoothness. **More results** has shaft speed (rpm) and the secondary numbers.
- **Foot editor**: the foot is drawn in its own frame, with the cam bearing centre P1 at the origin.
  - Drag anchors, handles and arc diamonds to reshape it.
  - Double-click an edge to add an anchor.
  - The inspector edits the selection numerically, in X/Y or polar r/θ about P1.
  - Presets give an arc foot (constant r), a flat-bottom foot or a teardrop.
  - **Mirror** (on by default) keeps the foot symmetric about its centreline, so edits on one side copy to the other. Turning it on keeps the right half; turn it off for an asymmetric foot.
  - The blue band marks the part of the outline that touches the ground.
- **Foot path**: one cam and foot animated, with the path of the foot's lowest point overlaid and the stance portion highlighted. The shaded **swept area** is everything the foot and cam occupy over a revolution: keep frame parts, standoffs and armour out of it in the plane of a foot (off by default; turn it on with the **Swept area** checkbox). The ground is a ruler (1 mm and 10 mm ticks, or 1/16″ to 1″ in inch mode) that slides by the robot's actual no-slip travel, so you can see the forward motion. The play bar under it plays, pauses and scrubs the cam angle; every view follows it.
- **Lowest point vs cam angle**: every foot's lowest point against cam angle. The grey band underneath is the envelope, i.e. the robot's bob. Dots mark handoffs.
- **Canvases** zoom with the wheel or a pinch and pan with a drag.
- **File menu**: New, Open, **Save…** (⌘/Ctrl+S, asks for a name) a `.shuffler.json` design, or export the foot, cam variants and frame holes as **SVG** or **DXF** (exact lines, arcs and cubic splines, in mm, named after the design). The design also autosaves in the browser.
- **Units**: everything is millimetres internally. The mm/in toggle changes only display and input.
- **Shortcuts**: Space play/pause, ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z (or Ctrl+Y) redo, ⌘/Ctrl+S save, Delete removes the selected anchor, Escape clears the selection.

Conventions: the cam turns counter-clockwise (φ increases) and the robot travels toward −x.

## Code layout

```
src/
  core/           Pure TypeScript math. No React, no app state (enforced by lint).
    math/         vectors, angles, root finding, quadrature
    curves/       segments, editable outline, contact pieces, support map, SVG path data
    spline/       piecewise cubic Hermite curves, adaptive fitting, Bézier conversion
    mechanism/    drive (eccentric cam), tilt constraints (registry + centreline slot)
    analysis/     foot kinematics, events, envelope, metrics, swept area, the memoised pipeline
    design/       schema, defaults, presets, derived hardware sizes, validation,
                  outline edits, mirroring, (de)serialisation
    export/       part layout, SVG and DXF writers
    test/         shared test helpers
  state/          zustand stores: design (undo/redo, autosave), UI (preferences, selection,
                  notices, dialog), playhead; useAnalysis
  ui/
    common/       Button, NumberField, SegmentedControl, Menu, Dialog, Panel, Section, …
    plot/         pan/zoom Viewport (world mm, y up), legends, ticks, path helpers
    views/        registry + PathView, FootEditor, HeightChart (+ shared mechanism glyphs, ground ruler, play bar)
    panels/       sidebar sections: Mechanism, Hardware, Results, More results, Issues
    layout/       AppShell, Header, SaveDialog, file actions
    hooks/        element size, keyboard shortcuts
```

Tests live next to the code they cover (`*.test.ts`).

## Extending

- **New view** (for example forward motion): write a component taking `{ analysis }` and add it to `src/ui/views/registry.ts` with an area. Views that share an area show as tabs, and an optional `actions` component renders in the panel header. Use `usePlayhead` to follow the shared cam angle.
- **New slot geometry**: implement `TiltConstraint` (`src/core/mechanism/constraints/types.ts`), add its spec to the `ConstraintSpec` union and a factory in `registry.ts`, and add its inputs to the Mechanism section. The math for offset and curved slots is in SPEC §4.4.
- **New editing behaviour** (like Mirror): implement `OutlineOps` (`src/core/design/outlineEdit.ts`). The editor gets the ops for the current mode from `useOutlineOps`.
- **New metric**: compute it from `Kinematics` in `src/core/analysis/metrics.ts` and add a row in `src/ui/panels/MetricsPanel.tsx`. Use the Results section for headline numbers and More results for everything else.
- **Derived data for views**: add a lazy getter to `Kinematics` in `src/core/analysis/analyze.ts`, so it costs nothing unless a view uses it. Data that also depends on hardware sizes (like the swept area, which includes the cam) goes on `Analysis` instead, memoised on its inputs.
