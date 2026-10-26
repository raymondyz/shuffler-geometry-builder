# Shuffler Geometry Builder: Spec, Math & Architecture

Status: v1 implemented, plus DXF foot import (§14.2–14.12). See the README for running and extending. Last updated 2026-10-24.

This document is the source of truth for what the tool does, the math it runs on, and how the code is organised. Sections 4–10 are the math; every formula marked ✔ was checked numerically (brute force and finite differences) before this was written. Section 9 gives a worked example whose numbers double as regression test values.

---

## 1. Context

### 1.1 Shufflers

A shuffler is a combat-robot drive where cam-driven feet push the robot along instead of wheels. A motor turns a cam shaft; offset (eccentric) cams on that shaft move the feet; feet are phased so that one is always on the ground. Event rules typically treat shufflers as "non-traditional" locomotion, separate from true walkers.

There are two families:

1. **Two cams per foot (parallel feet).** Each foot plate rides on two synchronised eccentric shafts, so it stays parallel to the ground and moves in a circle of radius = cam offset. Geometry is trivial; bob is large and stride is limited to the cam offset.
2. **One cam per foot (pivoting feet), the target of this tool.** Each foot rides on one eccentric cam and has a slot that a stationary shaft passes through. The slot forces the foot to tilt as the cam turns, which gives a heel-to-toe rolling, walking motion with a stride larger than the cam offset (lever effect). The cost: the mechanism is taller, only part of the foot touches the ground, and the motion is not top/bottom symmetric (an invertible robot needs some feet mounted flipped).

### 1.2 The mechanism

```
                 ● Ps     stationary shaft ("pin"), fixed to the frame
               ┌─┼─┐
               │ │ │      slot along the foot centreline (foot-frame +y axis)
               │ │ │
            ╭──┴─┴──╮
            │  ○ P0 │     cam shaft axis (motor-driven, fixed to the frame)
            │   · P1│     cam disc centre = foot bearing centre; |P0 P1| = L
            ╰───────╯     P1 orbits P0 as the cam turns
               │   │
               │   │      foot outline r(θ), polar about P1
               ╰─┬─╯
                 ▼        lowest point of the foot = ground contact
```

- **Cam shaft, P0.** Driven by the motor (usually hex or keyed). Fixed in the frame.
- **Cam.** A circular disc whose shaft bore is offset from its centre. The disc centre P1 orbits P0 at radius L (the eccentricity). The foot has a round bearing hole that rides on the disc. The disc diameter is not an input: it is sized automatically to fit the shaft (§12.3).
- **Foot.** One rigid body. Its full outline is described as a polar function r(θ) around P1 (conceptually; see §11.2 for the actual representation). The outline contains the bearing hole and the slot.
- **Stationary shaft, Ps.** Parallel to the cam shaft, fixed to the frame, passes through every foot's slot. Today the slot runs along the foot centreline through P1; other slot geometries (offset, angled, curved) are planned, so the constraint is a pluggable module.
- **Stack.** 3–5 identical feet sit side by side along the shaft (with spacers), cams phased 360°/N apart. Robots usually have one module per side, each with its own motor (tank steering).

### 1.3 What the tool is for

Help a builder design the best foot/cam/pin geometry for their use case. "Best" is a trade-off between three primary metrics:

1. **Bob**: how much the robot moves up and down.
2. **Stride**: how far the robot moves per step (per foot) and per cam revolution.
3. **Smoothness**: how cleanly feet hand off to each other, and how smooth the vertical and forward motion are.

For now the user tunes parameters and every view updates live. Automatic optimisation may come later; the architecture must not preclude it.

---

## 2. Requirements

### 2.1 Functional

- **Inputs:** number of feet N, eccentricity L, stationary shaft position Ps (relative to P0), tilt-constraint type and its parameters (only the centreline slot so far), foot outline (full closed outline, editable as splines, optionally mirrored), hardware sizes (shaft type and size, pin diameter, clearance, minimum wall; the cam disc is sized automatically), shaft RPM (only for converting per-radian results to time-based ones).
- **Path view:** the closed 2D curve traced by the lowest point of one foot over a full cam revolution, with an animation of one cam + foot moving and the curve overlaid.
- **Height chart:** y of the lowest point of every foot vs cam angle φ, overlaid; the lower envelope is the robot's bob; crossings are handoffs.
- **Results:** bob, stride and the main smoothness parts always visible, the rest one click away (§8, §13.5), all live.
- **Foot editor:** intuitive spline editing of the full outline (pen-tool style Bézier editing, arcs, presets, numeric entry in Cartesian or polar about P1).
- **Export/import:** CAD-ready geometry (DXF, SVG) and a native design file (JSON) that round-trips, saved under a user-chosen name. Foot outlines can be imported from DXF (§14.2).
- **Future views** (must be easy to add): forward displacement/speed vs φ, full-module animation (all feet + moving ground), pin/slot loads, design comparison, generator (§10, §13.6). (The swept area is done, §4.6.)

### 2.2 Non-functional

- **Fast and responsive.** Dragging a spline handle must update all views at display rate. Budget: full re-analysis ≤ 4 ms for typical designs (§11.9).
- **Continuous, not sampled.** Geometry and results are analytic functions or splines with known error bounds, never stored point clouds. Points exist only transiently (inside root-finders, or not at all, since SVG draws Béziers natively).
- **Extensible.** New tilt constraints, outline segment types, drives, metrics and visualisations plug in through small interfaces (§12.5) without touching the rest.
- **CAD-friendly.** Exported curves are exact (lines, arcs, cubic B-splines), in mm, importable into Fusion 360, Onshape, SolidWorks, FreeCAD.

### 2.3 Out of scope (for now)

Dynamics (inertia, impacts, motor torque curves), compliant feet, uneven ground, body pitch/roll, left/right module phasing, automatic optimisation.

---

## 3. Model and conventions

### 3.1 Frames

- **Body frame** (the default for all views): fixed to the robot frame. Origin at P0, x to the right, y up. P0 and Ps are fixed here; the ground is a horizontal line that moves up and down in this frame.
- **Foot frame:** origin at P1, rotates with the foot by tilt α. At α = 0 ("neutral") its axes are parallel to the body axes. **The user draws the foot in this frame at neutral**: P1 at the origin, centreline vertical, slot above.
- **Lab frame:** fixed to the ground (y = 0 is the floor). Used only for forward motion.

All internal angles are radians, counter-clockwise from +x. The UI shows degrees. φ = −90° (= 270°) means P1 is directly below P0.

**Decided conventions:**

- **Units.** Everything is millimetres internally. The UI has a mm/in toggle that affects display and input only.
- **Direction.** The cam turns counter-clockwise in every view (φ increases with time). With the pin above the shaft, the robot then travels toward −x. Strides and speeds are reported as magnitudes with a direction label.
- **2D robot.** Both shuffler modules stay in sync and the body stays parallel to the ground, so one module in one plane describes the robot.

### 3.2 Symbols

| Symbol | Meaning |
|---|---|
| P0 | cam shaft axis, origin of the body frame |
| φ | cam angle: direction of P1 about P0 (CCW from +x) |
| L | eccentricity, distance P0→P1 |
| P1(φ) | cam disc centre = foot bearing centre = foot-frame origin |
| Ps | stationary shaft (pin) centre, fixed in the body frame |
| α(φ) | foot tilt relative to neutral (CCW positive) |
| R(α) | 2D rotation matrix; J = R(π/2), so J(x, y) = (−y, x) |
| Γ | foot outline (closed curve) in the foot frame |
| r(θ) | polar description of Γ about P1 (user-facing concept) |
| n(ψ) | unit vector (cos ψ, sin ψ); n′(ψ) = (−sin ψ, cos ψ) |
| h(ψ) | support function of Γ (§5.1) |
| q\*(ψ) | support point: the point of Γ that maximises q·n(ψ) |
| ρ(ψ) | radius of curvature of Γ at q\* (0 at a corner) |
| ψ(φ) | foot-frame direction of "down" = −π/2 − α(φ) |
| N, Δ | number of feet, phase step Δ = 2π/N |
| yₖ(φ) | height of foot k's lowest point (body frame) |
| E(φ) | lower envelope minₖ yₖ(φ) = ground line in the body frame |
| X(φ) | robot horizontal position in the lab frame |
| ω | shaft angular speed (rad/s), from RPM |

Primes denote derivatives with respect to φ, except h′, h″ which are with respect to ψ.

### 3.3 Assumptions

1. Planar (2D) kinematics; all feet of a module lie in parallel planes and project onto one plane.
2. The body frame translates but does not rotate (no pitch or roll).
3. Rigid foot, rigid flat ground, contact at the lowest point of the foot.
4. No slip at the active contact (§7). Slip only appears as a reported mismatch at handoffs.
5. Quasi-static: geometry only, no inertia or impact dynamics.
6. Feet are identical and evenly phased (enables the symmetry shortcut in §6.1). Non-identical feet are a possible extension.

---

## 4. Kinematics

### 4.1 Drive: eccentric cam

$$P_1(\varphi) = P_0 + L\,n(\varphi),\qquad P_1' = L\,n'(\varphi),\qquad P_1'' = -L\,n(\varphi)$$

### 4.2 Foot pose

A foot-frame point q maps to the body frame as

$$W(q,\varphi) = P_1(\varphi) + R(\alpha(\varphi))\,q .$$

The pose has one degree of freedom, φ. The tilt constraint (§4.3, §4.4) provides α(φ) with its first two derivatives.

### 4.3 Centreline slot (current) ✔

The foot-frame +y axis (centreline from P1 toward the slot) must point at Ps. Let d = Ps − P1. The world direction of the local +y axis is R(α)(0, 1) = (−sin α, cos α), so

$$\alpha = \operatorname{atan2}(-d_x,\ d_y)$$

$$\alpha' = \frac{d_y P'_{1x} - d_x P'_{1y}}{|d|^2}$$

$$\alpha'' = \frac{d_y P''_{1x} - d_x P''_{1y}}{|d|^2} + \frac{2\,(d_y P'_{1x} - d_x P'_{1y})\,(d\cdot P_1')}{|d|^4}$$

**Tilt extrema.** α′ = 0 exactly when d ∥ P1′, i.e. (P1 − P0)·(Ps − P1) = 0, the line from Ps is tangent to the cam circle:

$$\varphi_{\text{ext}} = \varphi_s \pm \arccos\frac{L}{|P_s-P_0|},\qquad \varphi_s = \arg(P_s - P_0)$$

and the tilt range is α ∈ φs − π/2 ± arcsin(L/|Ps − P0|). Between the two extrema α is monotone (used for robust root bracketing in §11.5). Validity requires |Ps − P0| > L.

### 4.4 General tilt constraints (future)

**Offset or angled straight slot ✔ (closed form).** In the foot frame the slot centreline passes through s₀ with unit direction t = n(τ). Let w = Ps − P1, γ = arg w, and c = s₀ × t (2D cross product, a × b = aₓb_y − a_y bₓ). The pin lies on the slot line when

$$\alpha = \gamma - \tau + \arcsin\frac{c}{|w|}$$

(principal branch; the other branch is the flipped assembly). The centreline slot is the special case s₀ = 0, τ = π/2.

**Any constraint as an implicit equation.** Write the constraint as F(α, φ) = 0. For a curved slot, F is the signed distance of the foot-frame pin position s = R(−α)(Ps − P1) from the slot centreline curve. Solve for α by Newton's method, continuing from the previous φ. Derivatives come from the implicit function theorem:

$$\alpha' = -\frac{F_\varphi}{F_\alpha},\qquad \alpha'' = -\frac{F_{\varphi\varphi} + 2F_{\varphi\alpha}\alpha' + F_{\alpha\alpha}\alpha'^2}{F_\alpha}$$

F_α → 0 means the pin is moving along the slot tangent and can no longer set the tilt (lock-up / poor transmission). That margin is reported as a validity metric.

Note: for a slot (a 1D track) to constrain the foot, the pin's path in the foot frame must retrace itself over the cycle. A path that encloses area would need a pocket, not a slot. So the slot shape is the free design function, and α(φ) follows from it. α(φ) cannot be chosen arbitrarily.

### 4.5 Pin locus and slot geometry

The pin centre's path in the foot frame is

$$s(\varphi) = R(-\alpha(\varphi))\,\bigl(P_s - P_1(\varphi)\bigr).$$

For the centreline slot, s = (0, |Ps − P1|), with |Ps − P1| ∈ [|Ps − P0| − L, |Ps − P0| + L]. The slot cut-out is the pin circle (radius r_pin + clearance) swept along s(φ). For the centreline slot that is an obround of length 2L + 2(r_pin + c) and width 2(r_pin + c), centred at (0, |Ps − P0|). This is generated, not drawn by the user.

### 4.6 Swept area (keep-out zone) ✔

Everything a foot occupies over one revolution, in the body frame, is

$$S = \bigcup_{\varphi} W(F, \varphi)$$

where F is the solid foot (the region inside Γ). Anything placed inside S, in the plane of a foot (standoffs, frame members, armour, wiring), will be hit. The outer boundary of S is the keep-out line.

- **One region for every foot.** The feet differ only in phase, so they all sweep the same S, each in its own plane.
- **Holes don't matter.** The bore and slot are holes in F and don't change the outer boundary. The stationary shaft sits in the small hole of S that the slot leaves. Only the outer boundary is drawn.
- **The cam.** The cam disc rides inside the bore, so it adds nothing while the foot wall around the bore is valid. When it isn't, the disc pokes out. Its sweep is a disc of radius L + r_cam about P0, which is included so the line stays correct.

**Envelope condition.** In the foot frame, a foot point q moves with velocity R(−α) W_φ = u + α′ J q, where u = R(−α) P1′. Parametrise Γ by σ, with unit outward normal n(σ). The normal velocity of the outline is

$$g(\sigma,\varphi) = (u + \alpha' J q)\cdot n = u\cdot n + \alpha'\,(q\times n) = a(\varphi)\cdot b(\sigma)$$

with a = (uₓ, u_y, α′) (the foot's motion) and b = (nₓ, n_y, q × n) (the outline's normal line). The cam angle and the outline separate, which makes g cheap to tabulate.

- **Boundary points need g = 0.** A point of Γ whose normal velocity is not zero is covered by poses slightly before or after, so it lies inside S.
- **Geometric reading.** g = 0 means the outline's normal at q passes through the foot's instantaneous centre of rotation, c = J u / α′ in the foot frame.
- **Fold of the sweep.** The Jacobian of the sweep map (σ, φ) ↦ W is W_σ × W_φ = −|q_σ| g. So g = 0 is exactly where the moving outline folds over itself.
- **Corners.** At a corner, the condition holds for some normal inside the corner's normal cone, and the candidate is the corner's own path W(q_c, φ). Model each corner as a zero-length piece whose normal turns from the incoming to the outgoing normal. Then g is continuous all the way round Γ.

The candidate set K = {W(σ, φ) : g(σ, φ) = 0} therefore satisfies ∂S ⊂ K ⊂ S. The three identities above (the normal velocity, the Jacobian and g_φ) were checked against finite differences.

**Outer boundary.** P0 is always inside S, because the cam covers it. The boundary's distance from P0 in direction θ is

$$R(\theta) = \max\,\{\,|k| \;:\; k\in K,\ k \parallel n(\theta)\,\}$$

because the farthest point of S on a ray lies on ∂S ⊂ K and no candidate lies outside S.

- **When it is exact.** The curve r = R(θ) is exactly the outer boundary when every pose of the foot is star-shaped about P0. In the foot frame that means (q − o(φ))·n ≥ 0 all round Γ for every φ, where o(φ) = R(−α)(P0 − P1) is P0 seen from the foot. Practical feet pass easily.
- **When it isn't.** A hook or a deep notch facing away from P0 breaks the condition. Then r = R(θ) bounds the radial hull of S. That still contains all of S, so it is a safe, slightly larger keep-out line. The tool reports which case applies.

**Shape of the boundary.** The boundary is smooth along each candidate branch. Where one part of the foot takes over from another, two branches cross and the boundary has an inward (reflex) corner. At a candidate point, the boundary is tangent to the moving outline, or to the corner's path for a corner. With T its unit tangent, the exact derivative for spline fitting is dW/dθ = R T / (T·n′(θ)).

---

## 5. Ground contact

### 5.1 The lowest point is a support-function evaluation ✔

The body-frame height of foot point q is

$$y(q) = P_{1y} + q_x\sin\alpha + q_y\cos\alpha = P_{1y} - q\cdot n(\psi),\qquad \psi = -\tfrac{\pi}{2} - \alpha .$$

So the lowest point of the foot is the point of Γ that is furthest in the foot-frame direction n(ψ). That is exactly the **support function**:

$$h(\psi) = \max_{q\in\Gamma} q\cdot n(\psi),\qquad q^*(\psi) = \arg\max_{q\in\Gamma} q\cdot n(\psi)$$

$$\boxed{\,y_0(\varphi) = P_{1y}(\varphi) - h\bigl(\psi(\varphi)\bigr)\,}$$

In the user's polar terms, h(ψ) = max_θ r(θ) cos(θ − ψ). A constant r = R gives h ≡ R.

A useful identity: for a smooth convex piece, q\*(ψ) = h n(ψ) + h′ n′(ψ). Rotating into the body frame (where n(ψ + α) points straight down) gives the contact point relative to P1 directly:

$$\boxed{\,C_0(\varphi) - P_1(\varphi) = \bigl(h'(\psi),\ -h(\psi)\bigr)\,}$$

So h is the height of P1 above the ground and h′ is the horizontal offset of the contact point from P1.

### 5.2 Consequences that shape the tool

1. **Only the convex hull touches the ground.** The support function of a set equals that of its convex hull. Concave parts of the outline can never touch flat ground; the contact skips across them along a hull "bridge". `Kinematics.hull()` computes the hull; the editor doesn't draw it, to keep the view simple.
2. **The math says which part of the outline matters.** Over a revolution ψ(φ) only sweeps −π/2 − [α_min, α_max], so only outline points whose outward normal lies in that window are ever lowest. During stance (§6.3) the window is narrower still. Both bands are computed (`cycleBand()`, `stanceBand()`); the editor highlights the stance band. This is why the user can define the full outline without knowing in advance which part matters.
3. **Continuity.** h is continuous, so y₀(φ) is always continuous. At bridge directions h′ jumps: y₀ gets a kink and the contact point C₀ jumps horizontally. At a convex corner, q\* stays fixed over a range of ψ (ρ = 0) and the foot pivots on the corner. Kinks, jumps and corner contacts are detected as events (§11.5) and flagged when they happen during stance.
4. α oscillates, so the contact point sweeps back and forth over the same band of the outline twice per revolution. The body-frame trace is still a closed loop because P1 moves.

### 5.3 Derivatives ✔

Using h′(ψ) = q\*·n′(ψ), dq\*/dψ = ρ n′(ψ) with ρ = h + h″, and ψ′ = −α′:

$$y_0' = P_{1y}' + h'(\psi)\,\alpha'$$

$$y_0'' = P_{1y}'' - (\rho - h)\,\alpha'^2 + h'(\psi)\,\alpha''$$

$$C_{0x}' = P_{1x}' + \alpha'\,(h - \rho),\qquad C_{0y}' = y_0'$$

Vertical acceleration therefore depends on the foot's radius of curvature at the contact point, which is a direct design handle.

### 5.4 Path view definition

The path is the closed parametric curve C₀(φ), φ ∈ [0, 2π): one foot run through a full cycle with the robot suspended, tracking its lowest point. A good shape has a flat bottom, where the foot holds the body height during stance, with sides that rise smoothly for clean handoffs. The stance portion (§6.3) is drawn highlighted.

---

## 6. Multiple feet: envelope, handoffs, bob

### 6.1 Phasing and symmetry

Foot k runs at cam angle φ + kΔ, with Δ = 2π/N. All feet are identical, so

$$y_k(\varphi) = y_0(\varphi + k\Delta).$$

Only foot 0 is ever computed; the other feet are the same curves shifted (free to evaluate and to draw).

### 6.2 Envelope and handoffs

$$E(\varphi) = \min_k y_k(\varphi)$$

E is the ground line in the body frame (the robot's height above ground is −E). E is Δ-periodic, so it only needs analysing over one window of width Δ. The active foot k\*(φ) is the arg-min. A **handoff** is a φ_h where k\* changes, i.e. a root of y_out(φ) − y_in(φ) = 0. Before the handoff y_out < y_in and after it y_in < y_out, so

$$K_y(\varphi_h) = y_{\text{out}}'(\varphi_h) - y_{\text{in}}'(\varphi_h) \ge 0$$

is the jump in the slope of E: the vertical velocity change the body sees at touchdown.

### 6.3 Stance and double support

Foot 0's stance set is {φ : k\*(φ) = 0}, generically one interval of length Δ per revolution. If two feet stay within ε = 0.01 mm of each other over an interval (typical for flat-stance designs), that interval is **double support** and any forward-speed mismatch there is scrub (reported).

---

## 7. Forward motion and stride

### 7.1 No-slip rolling contact ✔

The material point of the active foot at the contact must be stationary in the lab frame. Its body-frame velocity per unit φ is

$$V = P_1' + \alpha'\,J\,(C_0 - P_1) = \bigl(P_{1x}' + \alpha' h,\ \ P_{1y}' + \alpha' h'\bigr).$$

The vertical component equals y₀′ automatically (the envelope theorem), consistent with the body bobbing. The horizontal component sets the robot's travel:

$$\boxed{\,v(\varphi) \equiv \frac{dX}{d\varphi} = -\bigl(P_{1x}'(\varphi) + \alpha'(\varphi)\,h(\psi(\varphi))\bigr)\,}\quad\text{(active foot)}$$

Ground speed is Ẋ = v·ω. Sanity check: a wheel (L = 0, α = φ, h = R) gives v = −R.

### 7.2 Stride

Over a stance interval [φa, φb]:

$$\Delta X = -\Bigl[\Delta P_{1x} + \int_{\alpha_a}^{\alpha_b} h\bigl(-\tfrac{\pi}{2} - \alpha\bigr)\,d\alpha\Bigr]$$

So the foot behaves like a wheel of variable radius h, rolled through the tilt, plus the cam's own horizontal travel.

- **Stride per step** S_step = |∫ v dφ| over one handoff period Δ.
- **Stride per revolution** S_rev = |X(φ + 2π) − X(φ)| = N·S_step.

### 7.3 Stride is not the width of the path ✔

The trace moves at C₀ₓ′ = P1ₓ′ + α′(h − ρ), while the ground moves past at P1ₓ′ + α′h. The difference α′ρ is rolling. With an arc foot (constant r) the trace is a circle only 2L wide, but the robot travels much further per step (§9: a 12 mm wide trace gives 67 mm per revolution). The forward-motion view and the stride metric must use v(φ), never the trace geometry.

### 7.4 Travel X(φ) and the moving ground ✔

The robot's travel is the integral of the active foot's speed:

$$X(\varphi) = \int_0^{\varphi} v_{k^*(\varphi')}(\varphi')\,d\varphi'$$

- **Periodicity.** The feet are identical and evenly phased, so X(φ + Δ) = X(φ) + ΔX_step, where ΔX_step is the signed travel per step. One envelope window therefore gives X for every φ, and X(φ + 2π) = X(φ) ± S_rev.
- **Continuity.** X is continuous. Its slope jumps at handoffs by the handoff slip K_x.
- **The ground in the body frame.** The ground sits at height E(φ) and slides horizontally by G(φ) = −X(φ). The contact's material point is still on the ground, so the ground moves at P1ₓ′ + α′h, exactly the foot's material speed at the contact (§7.1).
- **Path view.** The ground is drawn as a ruler fixed to it. The tick marks move exactly as the robot would see the floor go by, including speed ripple and the change of speed at handoffs.

---

## 8. Metrics

Per-radian quantities don't depend on RPM. Time-based ones multiply by ω (or ω²).

| Group | Metric | Definition | Units | Shown in |
|---|---|---|---|---|
| Bob | Bob B | max E − min E | mm | Results |
| Stride | Stride per step | S_step (§7.2) | mm | Results (under stride) |
| | Stride per revolution | S_rev = N·S_step | mm | Results |
| | Ground speed | S_rev × RPM / 60, with direction | m/s or ft/s | More results |
| Smoothness | Handoff kink K_y | max over handoffs of y_out′ − y_in′ | mm/rad | Results |
| | Touchdown speed | K_y·ω: the vertical velocity jump at each handoff | mm/s or in/s | More results |
| | Speed ripple | (max − min) / mean of the forward speed (along the direction of travel) over one step | % | Results |
| | Peak vertical acceleration | max magnitude of E″ on smooth parts (sampled), × ω² | g | More results |
| | Handoff slip K_x | max over handoffs of the absolute difference v_out − v_in | mm/rad | More results |
| | Stance events | count of contact jumps and corner contacts during stance (should be 0) | count | Issues (as warnings) |
| Secondary | Tilt range | foot tilt over the whole cycle (the stance tilt range is also computed) | deg | More results |
| | Foot lift | max of y₀ − E (sampled): how high a swinging foot clears the floor | mm | More results |
| | Double support | share of the cycle with a second foot within 0.01 mm of the stance foot (§6.3) | % | More results |

Not computed yet: slot length (§4.5) and the lock-up margin of general slot constraints (§4.4).

Smoothness is reported as its components only (decided). There is no combined score for now.

---

## 9. Closed-form baseline: arc foot (constant r) ✔

Take Ps = (0, D) directly above P0 with D > L, and r ≡ R over the active band. Then h ≡ R, h′ ≡ 0, ρ = R, and the contact point is always directly below P1.

| Quantity | Closed form |
|---|---|
| y₀(φ) | L sin φ − R |
| Path | circle of radius L centred at (0, −R) |
| Stance window | φ ∈ [−π/2 − π/N, −π/2 + π/N] |
| Bob | L (1 − cos(π/N)), i.e. 0.500 L, 0.293 L, 0.191 L for N = 3, 4, 5 |
| Tilt at stance edges | ± atan( L sin(π/N) / (D + L cos(π/N)) ) |
| Stride per step | 2L sin(π/N) + 2R·atan( L sin(π/N) / (D + L cos(π/N)) ) |
| Speed at mid-stance | L (1 + R / (D + L)) mm/rad |
| Handoff kink K_y | 2L sin(π/N) |
| Handoff slip K_x | 0 (mirror symmetry) |
| Max tilt | asin(L / D) |

**Takeaways.** An arc foot has the same bob as the two-cam type. All the extra stride comes from the lever effect (1 + R/(D + L)). Flattening bob and smoothing handoffs requires shaping the bottom of the outline, and that is what the editor is for.

**Worked example and regression values:** N = 3, L = 6, D = 40, R = 50 (mm).

| Metric | Value |
|---|---|
| Bob | 3.000 mm |
| Stride per step / per revolution | 22.418 / 67.254 mm |
| Path width | 12.000 mm |
| Magnitude of v: mid-stance / stance edge / mean | 12.522 / 7.158 / 10.704 mm/rad (mean = stride per step ÷ Δ) |
| Speed ripple | 50.1 % |
| Handoff kink K_y | 10.392 mm/rad |
| Handoff slip K_x | 0 |
| Max tilt / stance tilt | 8.627° / ±6.890° |
| At 600 shaft RPM | 0.67 m/s ground speed; 653 mm/s vertical velocity jump at each handoff |

---

## 10. Generator ✔

**Status: built** (`core/generate`, Generate mode in §13.6). The method was first prototyped with a real LP solver and checked by brute force (§10.10). The notes below describe the implementation; items marked *later* are not built yet.

### 10.1 What it does

The user describes the hardware, the available space, what may change and what matters. The generator returns a few good, different designs. Each candidate is a complete design (N, L, pin, outline, mirror flag) that the normal pipeline analyses, so every number the user sees is exact, never the optimiser's own estimate.

### 10.2 Inputs

| Group | Input | Notes |
|---|---|---|
| Layout | Symmetric | Mirror on, pin offset 0, stance centred under the shaft. Halves the unknowns. |
| | Feet | Allowed counts, e.g. 3–5, or one fixed value |
| | Eccentricity L | Fixed or a range |
| | Pin height | Fixed, a range, or free (limited only by space and walls) |
| | Pin offset | Asymmetric only: fixed or a range |
| Hardware | Shaft type and size, pin diameter, clearance, minimum wall | Shared with the design (§13.5). Cam and bore sizes follow from them (§12.3). |
| Space | Ride height | Shaft height above the ground: fixed, a range, or free |
| | Room above the shaft, room in front, room behind | The swept area (§4.6) must fit inside this box. The path view draws the box. |
| Shape | Minimum contact radius | Smallest radius of curvature where the foot touches the ground (wear, contact stress). Also rules out corners there. Default 5 mm. |
| | Lift 10° after handoff | How far the other feet must have risen 10° of cam after a handoff (stored as mm per radian). Zero allows double support and scrub (§6.3). |
| Goals | See §10.6 | Bob, stride per revolution, speed ripple, handoff kink, handoff slip (asymmetric only), foot lift |

The brief starts from the current design (Reset does this again):
- **Mechanism:** its feet count plus 3–5, and its L −40 %/+50 % as the eccentricity range. Pin height is free.
- **Ride height:** its value ± 5 mm.
- **Space:** its swept area plus 5 mm all round.
- **Goals:** Balanced, scaled to its stride.

In the UI, symmetric designs get one "room each side" value, because their swept area is symmetric.

Later inputs worth adding:
- goals in time units (m/s, g) via the shaft RPM, and peak vertical acceleration and swept size as goals;
- a motor torque limit, expressed as a cap on the peak speed ratio v (mm/rad), since torque per newton of push equals v;
- the cutter radius for concave corners;
- robot weight, for contact stress.

### 10.3 Key fact: with the mechanism fixed, everything is linear in h

Fix N, L and Ps. Then P1(φ), α(φ) and its derivatives are known functions, and every quantity the tool reports is linear in the support function h:

- height y₀ = P1y − h(ψ) (§5.1) and its slope y₀′ = P1y′ + α′ h′ (§5.3);
- vertical acceleration y₀″ = P1y″ − α′² h″ + α″ h′;
- speed v = −(P1x′ + α′ h) (§7.1) and stride S_step = −∫_W v dφ;
- handoff kink K_y and slip K_x, which are differences of y₀′ and of v at the handoff;
- contact points q(ψ) = h n(ψ) + h′ n′(ψ), and their body-frame position at any pose;
- radius of curvature ρ = h + h″.

So if h is a linear combination of basis functions, the following all become linear constraints or objectives:
- bob (max − min of y₀ over the stance window);
- ripple (max − min of v, with the stride fixed);
- kink and slip;
- ride height, wall thickness and "every contact point stays inside the space box".

The max, min and absolute values use the standard LP reformulations. **For a given mechanism, the best contact profile is a linear program**, solved to its global optimum in milliseconds.

### 10.4 Profile representation

Parametrise the contact profile by its radius of curvature, as a uniform cubic B-spline over the cycle band (16 coefficients):

$$\rho(\psi) = \sum_j c_j B_j(\psi),\qquad h(\psi) = a\cos\psi + b\sin\psi + \int_{\psi_0}^{\psi}\rho(t)\,\sin(\psi - t)\,dt$$

ψ₀ is the middle of the band. Integrating from there matters: for a band centred on −π/2, symmetric c_j with a = 0 then give an exactly mirror-symmetric profile. Integrating from one end does not, and the symmetric LP turned infeasible in testing. The integrals of the B-spline against cos t and sin t use 8-point Gauss–Legendre per knot interval, so they are exact to machine precision.

- **Exact curvature.** h + h″ = ρ holds exactly. Requiring c_j ≥ ρ_min makes the profile convex with radius at least ρ_min everywhere, not just at sample points, because a B-spline lies within the range of its coefficients.
- **Position.** (a, b) places the profile relative to P1.
- **Symmetric designs.** Set a = 0 and make the c_j symmetric about ψ = −π/2.
- **Why not a spline of h directly?** The prototype first tried constraining h + h″ on a spline of h. The h″ coefficients are about 2500 times larger than h's, and the solver's tolerance became 0.08 mm of radius error. The ρ form has no such problem.

### 10.5 The inner LP

Given N, L, Ps and foot 0's stance window W = [φc − Δ/2, φc + Δ/2] (φc = 270° when symmetric):

- **Variables:** a, b, c_j, plus a few auxiliaries that bound maxima and minima.
- **Constraints**, sampled at about 120 angles in W and 60 directions in the band:
  1. *Foot 0 is lowest during W, and handoffs are clean.* For k = 1…N−1: y₀(φ + kΔ) − y₀(φ) ≥ m × (distance from φ to the nearer end of W). m is the clean-handoff input.
  2. *Ride height:* −y₀ on W stays within the user's range.
  3. *Space:* every contact point at every pose lies inside the box. The bore and slot discs are fixed shapes, so they are checked once.
  4. *Walls:* h ≥ bore radius + minimum wall across the band.
  5. *Radius:* c_j ≥ ρ_min.
  6. *Limits from the goals* (§10.6), e.g. stride ≥ 60 mm or bob ≤ 1 mm.
- **Objective:** the goal score (§10.6).
- **Tie-breaks** for parts no goal cares about are tiny (10⁻⁶ per mm):
  - prefer smaller radii, so the foot curls up where it needn't be flat and stays compact;
  - avoid bends in the radius profile (second differences of the c_j), so it has no wiggles.
- **Wall headroom:** the discs carry 0.05 mm over the minimum wall, so validation never meets a wall exactly at the limit.
- **Space box:** it is checked at 48 poses, on the contact curve's two ends plus the 3 mm end-arc margin (§10.8). The curve's x and y extremes are always at its ends, because all its normals point downward.
- **Elastic limits:** limits, ride height and space can be violated at a cost of 100 per unit of normalised violation. An impossible request still returns its least-bad answer, and the outer search can steer by it. Lowest-foot, wall and curvature rules are hard.
- **Ripple goals** need the mean speed in one term. The LP is solved once with an estimate, then again with the actual mean if it differs by more than 3 %.
- **Solver:** HiGHS 1.15.3 (MIT licence; 3.5 MB of WebAssembly, 1.2 MB gzipped), through its array-based model API. It runs in a Web Worker and loads when Generate is first pressed. It sits behind a one-function interface (`LpSolver`), so it can be swapped. Typical size: about 750 rows and 45 columns, about 2 ms per solve.

### 10.6 Goals and priorities

Each metric can be set to one of three modes. The metrics are bob, stride, speed ripple, handoff kink, handoff slip, peak vertical acceleration, foot lift, swept size and ride height.

- **Ignore.**
- **Limit:** a hard requirement in the metric's own units, e.g. "stride ≥ 60 mm" or "bob ≤ 1 mm". Candidates that miss it are never shown. If nothing can meet the limits together, the generator says which ones conflict.
- **Goal:** an *ideal* value, an *acceptable* value, and an importance of low, normal or high (weights 1, 2, 4).

How goals are scored:
- **Shortfall.** For goal i, s_i = (value − ideal) / (acceptable − ideal), clipped at 0. So 0 means ideal and 1 means just acceptable.
- **Score.** Minimise max_i(w_i s_i) + 0.01 Σ w_i s_i, an augmented weighted Chebyshev score.
- **What the max term does.** It always improves the worst-off goal first, so no goal is quietly sacrificed for another, and the importance sets how much slack each goal gets.
- **What the sum term does.** It breaks ties. Both terms fit in an LP.
- **Reading the result.** A design scoring ≤ 1 meets every goal's acceptable value.

Why anchors instead of weight sliders: weights have no units, and their effect depends on each metric's scale, so moving a slider has unpredictable results. "Ideal 0.5 mm, acceptable 2 mm" says what the user means, in units they already think in.

Ripple is a ratio, (max − min)/mean. Each LP fixes the stride, which makes ripple linear. The outer search then varies the stride target.

Presets fill in sensible goals: Balanced, Smooth (bob, ripple, kink), Fast (stride) and Compact (swept size).

### 10.7 Outer search

As built:
- **Grid size** depends on how many dimensions are free: 7, 5, 4 or 3 points per dimension for 1, 2, 3 or 4 of them. That is followed by two Nelder–Mead starts of 24 evaluations per feet count.
- **Rounding:** chosen mechanisms are rounded to 0.1 mm and solved again, so designs come out in tidy numbers.
- **What's shown:** the best design for each feet count, then the next best that differ, up to five in all.
- **Speed:** the default brief (3–5 feet, an L range, free pin height) takes about 1.3 s, around 280 LPs.

- **What it searches.** N (the allowed set), L, pin height, pin offset, and φc (the latter two for asymmetric designs only). Each point is one LP.
- **How.** A coarse grid first, then Nelder–Mead from the best few points. Infeasible points report how far they are from feasible, which steers the search.
- **Running it.** It runs in a worker, results stream in, and the user can stop early. A few seconds is typical.
- **What it keeps.** The best design for each N, plus a few good designs that differ meaningfully, so the user sees real alternatives rather than near-duplicates.

### 10.8 The rest of the outline

Only the cycle band ever touches the ground. The rest of the outline is the convex hull of three shapes:
- the contact curve;
- the bore disc, of bore radius + wall about P1;
- the slot's obround, grown by the wall.

That gives tangent lines from the ends of the contact curve to an arc around the slot's top end, like the teardrop preset.

As built, the contact curve doesn't stop abruptly at the band ends. It continues as an end arc of radius min(ρ_end, 3 mm), turning up to 180°, until a common tangent with a disc takes over. So the outline is tangent-continuous everywhere, and the end arcs lie outside the band, where they never touch the ground.
- **It never touches the ground.** The hull is convex, so its normals outside the contact curve lie outside the cycle band.
- **It is as compact as possible,** which keeps the swept area small.

The result is converted to editable nodes:
- the contact curve becomes smooth cubics, fitted to 0.05 mm. Each cubic is checked to be strictly convex, using the exact quadratic for B′ × B″, because a nearly flat cubic can hide an inflection that makes the contact jump. That gives 20–26 anchors in total;
- the sides become lines and the top an arc;
- Mirror is turned on for symmetric designs.

A "fuller" option can come later, if hulls look too lean.

### 10.9 Verification

Each candidate goes through the normal analysis (§11) and the swept area (§4.6), which is checked against the box. The candidate list shows those numbers.

The tests check:
- the profile identities (h + h″ = ρ and q′ = ρ n′) against finite differences;
- that on the default mechanism, the LP's bob, stride and ripple agree with the full analysis of the generated outline, with no design errors, contact jumps or corner contacts, and with the ride height in range;
- that the swept area stays inside a tight space box;
- that an impossible limit comes back as "infeasible" rather than failing;
- that an end-to-end search returns verified, distinct candidates in 0.1 mm steps that meet the brief.

### 10.10 Prototype findings

Prototype: HiGHS from Node, with the profile of §10.4. Every solution was re-checked by brute force: the envelope over 7200 angles and the radius over 4000 directions. The checker first reproduced the §9 arc-foot values exactly. Mechanism: N = 3, L = 6, pin 40 mm above the shaft, ride height ≤ 60 mm, ρ_min = 5 mm, clean handoff 1 mm/rad, unless noted otherwise.

- **Bob is nearly free.** At the arc foot's stride (67.25 mm/rev), the lowest bob is 0.02 mm, against 3.0 mm for the arc foot, and ripple even improves (47 % vs 50 %).
- **Shape barely moves ripple.** Allowing more bob buys very little: 47 % at 0.5 mm, 44 % at 3.3 mm.
- **Stride is capped by space and leverage.** The most this mechanism can do with bob ≤ 0.5 mm and ride height ≤ 60 mm is 70.8 mm/rev, and ride height is the binding limit.
- **The mechanism sets ripple and the available stride.** Maximum stride with bob ≤ 0.5 mm and ride height ≤ 60 mm:

| | L = 4 | L = 6 | L = 9 |
|---|---|---|---|
| N = 3, pin 40 | 48.7 mm, 51 % | 70.8 mm, 47 % | 101.3 mm, 42 % |
| N = 4, pin 40 | 52.4 mm, 27 % | 75.7 mm, 25 % | 107.5 mm, 22 % |
| N = 5, pin 40 | 54.1 mm, 17 % | 77.9 mm, 16 % | 110.4 mm, 14 % |
| N = 4, pin 30 | 61.4 mm, 25 % | 87.8 mm, 22 % | 122.8 mm, 19 % |
| N = 4, pin 55 | 44.7 mm, 29 % | 65.1 mm, 27 % | 93.8 mm, 25 % |

**As built, the default brief** (space taken from the default design) returns, best first:
- 5 feet, L = 8.1 mm, pin 34.5 mm: bob 0.02 mm, stride 102.4 mm/rev, ripple 13 %;
- the best 4-foot design: bob 0.13 mm, 106.5 mm, 20 %;
- the best 3-foot design: bob 0.62 mm, 96.7 mm, 37 %.

The default arc foot gives bob 3.0 mm, 67.3 mm, 50 %.

**Width.** Flat-stance feet are wide: zero bob on N = 3, L = 6, pin 40 needs a bottom radius around 500 mm. The space box is what keeps them in check.

So the foot shape takes care of bob almost for free, and the mechanism (N, L, pin height) decides ripple and how much stride fits in the space. Cutting ripple further needs a different slot (§4.4), which is a natural later addition to the outer search. This is also what the UI should tell users, so they adjust the inputs that actually matter.

### 10.11 Special case: flat stance in closed form ✔

The support-function form can be inverted. Suppose we want a perfectly flat stance, y₀(φ) = −c on a window W slightly wider than Δ (the overlap gives soft touchdown). §5.1 then requires

$$h\bigl(\psi(\varphi)\bigr) = P_{1y}(\varphi) + c,\qquad \varphi\in W .$$

α(φ) is monotone on W (W lies between the tilt extrema of §4.3), so φ(ψ) can be inverted and h(ψ) is known on the stance band. The bottom profile then follows exactly from q\*(ψ) = h n + h′ n′. It is buildable if and only if ρ = h + h″ > 0 (convex).

Example (§9 parameters, c = 56, W = stance ± 10°): ψ spans 15.3° and the minimum radius of curvature is about 403 mm, a nearly flat bottom. The tool would fit this exactly-defined curve with Béziers to tolerance and blend it into the user's sides with C1/C2 continuity.

This flattens bob but leaves speed ripple. Reducing ripple too needs a second design function: the slot shape (§4.4), which reshapes α(φ). That is a constrained problem, because the pin path must retrace itself. It fits the generator's outer search (§10.7) as extra variables.

---

## 11. Numerical methods (continuous, not sampled)

### 11.1 Principle

Every quantity is either (a) an analytic evaluator f(φ) with exact derivatives, or (b) a piecewise-cubic spline built from (a) with a guaranteed error bound and explicit breakpoints at known events. Metrics come from root-finding and quadrature on (a). Views and exports draw (b) natively as Béziers. Nothing is stored as point samples.

### 11.2 Outline representation

The user thinks of the foot as a polar function r(θ). Internally the outline Γ is a **closed chain of segments in the foot frame**, each a **line**, a **circular arc**, or a **cubic Bézier**: the same primitives CAD sketches and SVG paths use. Reasons:

- **Exact CAD export.** Lines, arcs and cubic Béziers map one-to-one to DXF LINE/ARC/SPLINE and SVG path commands. A polar spline would need lossy conversion.
- **Exact, fast contact.** The support point on a cubic Bézier comes from a quadratic equation (§11.4).
- **Intuitive editing.** Pen-tool anchors and handles, which are familiar from Figma, Illustrator, Inkscape and CAD.
- **Superset.** Every polar r(θ) curve is star-shaped about P1 and can be represented (exactly for a constant r, as an arc; to tolerance otherwise). The polar view stays as a UI concept: numeric entry and readout in (r, θ) about P1, snapping to circles about P1, and a "constant r" arc preset.

### 11.3 Preprocessing (on every outline edit)

1. Orient Γ counter-clockwise (positive signed area).
2. Split cubics at inflections, the roots of B′(t) × B″(t). For a cubic this is a quadratic in t because the t³ terms cancel. Treat zero-length handles and cusps as corners.
3. Classify each piece: **convex** (tangent turning CCW) or **concave**. Arcs follow their sweep direction; lines are flat (a single normal direction).
4. Corners are junctions with a tangent discontinuity. A convex corner becomes a contact piece covering the normal-angle interval [ψ_in, ψ_out] at a fixed point. Concave corners are dropped.
5. Concave pieces are dropped (§5.2.1). The remaining convex pieces and convex corners are the hull candidates.

### 11.4 Support map

The support map is a sorted partition of ψ ∈ [−π, π) into intervals, each owned by one contact piece:

- **Cubic piece B(t):** the support for direction ψ solves B′(t)·n(ψ) = 0, a quadratic in t with one root in the piece's range (the tangent angle is monotone after inflection splitting). ρ = |B′|³ / (B′ × B″).
- **Arc** (centre c, radius a): q\* = c + a n(ψ), h = c·n + a, ρ = a.
- **Corner** at vertex p: q\* = p, h = p·n(ψ), ρ = 0.

Where several candidates cover the same ψ (non-convex outlines), the winner is the one with the largest q\*·n. Points where the winner changes ("bridge" directions) come from root-finding the difference of the two candidates' h values (Brent's method). Lines create zero-width bridge intervals, i.e. contact jumps. Built once per outline edit; a lookup is a binary search plus one closed-form solve. Every lookup returns {h, h′, ρ, q\*, piece id}.

Construction: every candidate is evaluated at 512 evenly spaced directions plus every piece's range boundaries, and each change of winner is refined with Brent's method. When a switch falls exactly on a shared piece boundary (a smooth junction or a corner), the exact boundary is used instead, because the two supports touch tangentially there and root-finding is ill-conditioned. Two owners meet continuously if their support points agree within 10⁻⁶ mm; otherwise the switch is a contact jump.

### 11.5 Events in φ

Within any φ-interval between events, every per-foot function is C∞, which makes spline fitting efficient and exact. The events are:

1. **Tilt extrema** α′ = 0 (closed form for the centreline slot, §4.3; numeric for other constraints). These split the cycle into intervals where α is monotone.
2. **Support-map breakpoints crossed:** α(φ) = −π/2 − ψ_b. On each monotone-α interval each breakpoint is crossed at most once, so bracketing is guaranteed; refine with Brent's method.
3. **Handoffs:** roots of y₀(φ) − y₀(φ + kΔ) where the arg-min changes (§11.8).

Each event records its type: smooth, kink (slope jump) or jump (position jump, x only).

### 11.6 Spline outputs: adaptive Hermite fitting

On each event-free interval [a, b], fit a cubic Hermite piece from the exact values and exact derivatives at both ends. Compare against the exact evaluator at t = ¼, ½, ¾. If the error exceeds tolerance, split at the midpoint and recurse (at most 14 levels deep). The error shrinks as O(h⁴), so curves typically need only tens of pieces.

- `Curve1D` (for example y₀(φ), E(φ), v(φ)): an ordered list of Hermite pieces, each with its φ range and the value and derivative at both ends. Pieces are contiguous in φ. At an event the next piece may start from a different value or slope, which is how kinks and jumps are represented; the renderer starts a new subpath wherever consecutive pieces don't touch.
- `Curve2D` (for example the path C₀(φ)): the same for planar curves.
- **Hermite to Bézier:** control points are P_i, P_i + h·P_i′/3, P_{i+1} − h·P_{i+1}′/3, P_{i+1}, with h = φ_{i+1} − φ_i. For a graph of y vs φ the abscissa is linear in the parameter, so the representation is exact. Béziers are affine-invariant, so mapping data to screen coordinates keeps them exact.
- Default tolerance is 1e-4 mm absolute: far below what is visible or machinable, and tight enough for reference-curve export.

### 11.7 Integration

Stride integrates v(φ) with 8-point Gauss–Legendre quadrature, two panels per event-free piece of the envelope. v is C∞ there, so the result is near machine precision.

`Kinematics.travelAt(φ)` evaluates X(φ) (§7.4) the same way. It adds three parts:
- the travel up to each envelope piece of one window, computed once;
- whole windows, using X(φ + Δ) = X(φ) + ΔX_step;
- one partial integral up to φ (16 evaluations).

That is exact to quadrature precision and costs tens of microseconds, cheap enough to call every animation frame. A stored Curve1D for X can come with the forward-motion view.

### 11.8 Envelope algorithm

1. Evaluate minₖ y₀(φ + kΔ) on a grid of 240 points over one window [0, Δ], plus every foot's events mapped into that window (evaluations cost about 1 µs each).
2. Wherever the arg-min changes between neighbouring grid points, root-find the crossing exactly.
3. Fit E between handoffs (§11.6), marking each handoff as a kink knot. Record K_y and K_x there.
4. Map the windows back to stance intervals of foot 0, and flag double support (§6.3).

### 11.9 Tolerances and performance budget

An evaluation is one constraint solve plus one support-map lookup, about a microsecond in JS. A full analysis (events, foot-0 fits, envelope, quadrature) is about 10⁴ evaluations, so it lands comfortably under 4 ms: measured at about 2 ms for each preset, including outline preparation. The support map is rebuilt only when the outline changes, and the mechanism stage only when L, Ps or the constraint change (§12.4). If future features (an optimiser, design sweeps) exceed the budget, the pure core moves into a Web Worker without code changes (§12.2).

### 11.10 Swept-area algorithm

Implements §4.6.

1. **Loop pieces.** The CCW outline becomes a loop of pieces: each segment, plus a zero-length corner piece wherever the tangent turns. σ = piece index + local parameter.
2. **Grid.** Tabulate g = a(φ)·b(σ) on 360 φ rows × σ columns (48 per cubic, one per 3.75° of arc, 4 per line or corner). a is computed once per row and b once per column, so each cell costs one 3-term dot product.
3. **Contours.** Marching squares, periodic in both σ and φ, finds the zero set of g. Each crossing is mapped into the body frame, giving short chords of the candidate curves K.
4. **Seeds.** The chords are rasterised onto 720 rays from P0, keeping the farthest hit on each ray with its (σ, φ). The cam disc's sweep competes as a circle.
5. **Trace.** Walk round the rays. On each ray, Newton's method solves {W(σ, φ) on the ray, g(σ, φ) = 0}, continuing the current branch. If the ray's seed comes from a different branch and could be further out, it is solved too, and the outer one wins. A change of branch is located exactly by Brent's method on R_A(θ) − R_B(θ).
6. **Fit.** Each branch's θ-interval is fitted with adaptive cubic Hermites (tolerance 10⁻⁴ mm) from the exact point and derivative at any θ, then stored as Béziers. The reflex corners between branches are exact crossings.
7. **Star check.** On the same grid, the minimum of (q − o(φ))·n decides whether the result is exact or the conservative radial hull.

Accuracy: every boundary point comes from the exact equations, and the splines are within 10⁻⁴ mm of them. The grid only supplies starting points. A branch that pokes out by less than the grid's chord error (about 0.05 mm at worst) over less than one ray spacing (0.5°) could be missed. In tests it agrees with a brute-force union of 2000 poses to better than 0.001 mm, and it always lies on or just outside it. It takes 2–7 ms and runs lazily, only when a view asks for it.

---

## 12. Architecture

### 12.1 Stack

- **React 19 + TypeScript + Vite + oxlint** (already scaffolded in this repo).
- **zustand**: design store with selector subscriptions, so dragging re-renders only what changed.
- **vitest**: tests for the math core.
- **No charting library.** Plots are custom SVG components that render `Curve1D`/`Curve2D` as Bézier paths. Charting libraries generally take point arrays, which would break the continuous-data requirement.
- **@tarikjabiri/dxf** for DXF writing (R2007/AC1021 output). It is loaded on demand when exporting.
- **highs** (HiGHS 1.15.3, MIT): the generator's LP solver (§10.5), compiled to WebAssembly. It runs in a Web Worker and loads when Generate is first pressed.
- Possible later additions: Comlink (worker), lz-string (shareable URLs).

### 12.2 Layering and folder layout

The core is pure TypeScript with no React or DOM imports (enforced by a lint rule). That means it runs in tests, in a worker, or in a future CLI unchanged.

```
src/
  core/                pure TypeScript; lint forbids React, zustand, ui/ and state/ imports here
    math/              vec2, angle, roots (quadratic, Brent, grid bracketing), quadrature (Gauss–Legendre)
    curves/            segment (Line | Arc | Cubic), outline (editable model, compile, area, validation geometry),
                       contactPieces, supportMap (+ hullFragments), pathData (SVG path strings)
    spline/            curve (Hermite pieces, adaptive fit, Bézier conversion)
    mechanism/         drive (eccentric), constraints/ (types, registry, centerlineSlot)
    analysis/          prepare (outline stage), foot (evaluator), events, footCurves, envelope, metrics,
                       swept (keep-out zone, §4.6), analyze (pipeline)
    generate/          brief (inputs, goals, presets), profile (curvature B-spline), lp (builder, solver
                       interface), highsSolver, inner (one LP per mechanism), closure (outline), search
    design/            schema, defaults, presets, hardware (derived sizes), validate,
                       outlineEdit (free edits, OutlineOps), mirror (symmetric editing), serialize
    export/            parts (sheet layout, cam variants), svg, dxf
    import/            DXF foot import (§14.12): dxf/ (reader, entities, nurbs), segments, loops, features,
                       place, simplify, toOutline, units, importFoot
    util/              lazy, memoizeLast
    test/              shared test helpers (seeded PRNG, random outlines, finite differences)
  state/               designStore (undo/redo, gestures, autosave), uiStore (mode, preferences, editor selection,
                       notices, open dialog), generatorStore (brief, run, candidates, preview), playhead (shared φ
                       + rAF loop), storage (safe localStorage), useAnalysis (design and preview analyses)
  workers/             generate.worker (loads HiGHS, runs the search), generateProtocol (messages)
  ui/
    common/            Button, Icon, InfoTip, NumberField, SegmentedControl, Select, Checkbox, Menu, Dialog, Panel, Section
    plot/              Viewport (pan/zoom world view) + viewportContext, Legend, ticks, paths
    views/             types, registry, ViewArea, palette, path/PathView, height/HeightChart,
                       editor/ (FootEditor, FootPreview, EditorCanvas, Inspector, Overlays, editorBounds,
                       useOutlineOps, useWorldDrag), candidates/CandidatesView,
                       shared/ (MechanismGlyphs, GroundRuler, Transport)
    generate/          GeneratePanel (the brief), SpanField, GoalRow
    panels/            ParametersPanel (Mechanism, Hardware), MetricsPanel (Results, More results), IssuesPanel
    layout/            AppShell, Header, SaveDialog, ImportDialog (loaded on demand), fileActions
    hooks/             useElementSize, useShortcuts, keyboard (focus helpers)
    format.ts          unit conversion and number formatting (mm internally, mm/in on screen)
  App.tsx, main.tsx, index.css (design tokens, light and dark)
```

Tests sit next to the code they cover, as `*.test.ts`.

### 12.3 Design document (versioned, serialisable)

```ts
interface Design {
  schemaVersion: 1
  name: string                    // shown in the header; used for file names
  units: 'mm'
  feet: { count: number }
  drive: { kind: 'eccentric'; L: number }
  constraint:
    | { kind: 'centerlineSlot'; pin: Vec2 }
    // future: { kind: 'offsetSlot'; pin: Vec2; s0: Vec2; tau: number }
    // future: { kind: 'curvedSlot'; pin: Vec2; path: Outline }
  foot: {
    outline: Outline              // closed chain of nodes + segment kinds, foot frame at neutral
    mirror: boolean               // keep the outline symmetric about the centreline (§13.4)
  }
  hardware: {
    shaft: { kind: 'round' | 'hex'; size: number }
    pinDiameter: number
    clearance: number
    minWall: number
  }
  operating: { shaftRpm: number }
}

interface Outline {
  // Handles are offsets from p
  nodes: { id: string; p: Vec2; hIn: Vec2; hOut: Vec2; mode: 'corner' | 'smooth' | 'symmetric' }[]
  // Edge i joins node i → i+1 (wrapping); bulge = tan(sweep/4), used by arcs only
  edges: { kind: 'cubic' | 'line' | 'arc'; bulge: number }[]
}
```

The editor works on nodes and handles (the pen-tool model). `curves/outline` compiles them into segments for the core.

Sizes that follow from others are derived, not stored. `design/hardware` computes:

- the cam radius: L + shaft hole radius (hex corner or round radius, plus clearance) + minimum wall;
- the foot's bearing hole: cam radius + clearance;
- the slot half-width: pin radius + clearance.

**File compatibility.** `parseDesign` validates a file and reports the first problem in plain words. Optional fields added since the format was introduced get defaults (`name`, `foot.mirror`), and obsolete ones are ignored (`hardware.camDiameter`), so older files still open. A design saved in mirror mode is re-symmetrised on load rather than trusted. A migration step will be needed once `schemaVersion` changes.

### 12.4 Compute pipeline and memoisation

```
design.foot.outline ──► preprocess ──► supportMap ─────────────┐
design.drive + design.constraint ──► tilt evaluator ───────────┼──► analyze(N) ──► Analysis
design.hardware ──► slot/validity checks ──────────────────────┘
```

Each stage is memoised on the identity of its inputs. Design updates are immutable, so unchanged sub-objects keep their identity. Dragging an outline handle reruns preprocess, supportMap and analyze; changing L skips the outline stages. Editor drags apply at most one update per animation frame.

`Analysis` holds the prepared outline, the mechanism, `issues`, `kinematics` (null when a blocking error exists) and a lazy `swept()` (the keep-out zone, §4.6; it depends on the cam size, so it sits outside `Kinematics` and is memoised on the kinematics, outline and cam radius). `Kinematics` exposes the exact foot evaluator `model.sample(φ, piece?)` (pose, contact, y, v and derivatives), `envelopeAt(φ)`, `travelAt(φ)` (the robot's travel X, §7.4), the fitted curves (`curves.height`, `curves.trace`, `curves.speed`, `envelope`), `metrics` and `bands`. It also has **lazily computed, cached** extras for views (`stanceTrace()`, `hull()`, `cycleBand()`, `stanceBand()`). A new view that needs new derived data adds one lazy getter and costs nothing when it isn't shown.

### 12.5 Extension points

```ts
interface Drive {
  kind: string
  L: number                                // eccentricity
  p1(phi: number): Vec2                    // P1 and its first two derivatives
  p1d(phi: number): Vec2
  p1dd(phi: number): Vec2
}

interface TiltConstraint {
  kind: string
  pin: Vec2                                // stationary shaft centre
  tilt(phi: number): { alpha: number; d1: number; d2: number }
  tiltExtrema(): number[]                  // φ where α' = 0, for bracketing
  pinLocus(): Segment[]                    // foot-frame pin path
  slotOutline(radius: number): Segment[]   // generated slot cut-out
  issues(): ConstraintIssue[]              // e.g. |Ps − P0| > L
}

interface ContactPiece {                   // from curve preprocessing; one per hull candidate
  kind: 'cubic' | 'arc' | 'point'
  segIndex: number
  psiStart: number                         // outward-normal range it owns: [psiStart, psiStart + psiSpan]
  psiSpan: number
  t0: number                               // parameter range on its segment
  t1: number
  inRange(psi: number): boolean
  support(psi: number): { q: Vec2; h: number; hd: number; rho: number }
  paramAt(psi: number): number
}

interface OutlineOps {                     // foot editing; freeOps and mirrorOps implement it
  moveNode, moveHandle, setNodeMode, setEdgeKind, setEdgeBulge, insertNode, deleteNode
  canDelete(outline: Outline, id: string): boolean
  isAxisNode(outline: Outline, id: string): boolean   // x locked on the mirror line
}

interface ViewDefinition {
  id: string
  title: string
  area: 'primary' | 'secondary' | 'bottom'               // views sharing an area become tabs
  component: React.ComponentType<{ analysis: Analysis }>
  actions?: React.ComponentType<{ analysis: Analysis }>  // controls/legend in the panel header
  info?: string                                          // what the view shows, behind an ⓘ beside its title
}
```

- **New slot geometry:** implement `TiltConstraint`, add its spec to the `ConstraintSpec` union and a factory in `constraints/registry.ts`, and add its parameters to the Mechanism section. Only the centreline slot exists today, so there is no constraint picker yet.
- **New segment type:** implement eval/derivatives/split/export in `curves/segment` and a `ContactPiece` producer in `curves/contactPieces`.
- **New editing behaviour** (like Mirror): implement `OutlineOps`; the editor calls whichever ops the design's mode selects (`outlineOps(mirror)`).
- **New visualisation:** add a `ViewDefinition` to `ui/views/registry.ts`. It reads `Analysis` and the playhead hook.
- **New metric:** add it to `Metrics` and `computeMetrics` in `analysis/metrics`, then show it in `ui/panels/MetricsPanel` (Results for headline numbers, More results for the rest).

### 12.6 State and playhead

- `designStore` (zustand) holds the design and its undo/redo history. A slider or drag gesture is merged into one undo entry. It autosaves to localStorage (debounced).
- `uiStore` holds the app mode (Design or Generate), display preferences (units, theme, show all feet, show swept area, snap, chart range; persisted), the editor selection, notices and the open dialog.
- `generatorStore` holds the brief (persisted in the browser), the run status and progress, the candidates and the selected one. The search runs in `workers/generate.worker` and messages carry a request id, so a stopped or superseded run is ignored; Stop terminates the worker. `useAnalysis()` returns the selected candidate's analysis in Generate mode, through a separate memoised analyser, and the design's otherwise. `useDesignAnalysis()` always returns the design's.
- The `playhead` (current φ, whole revolutions completed, playing, speed) is a separate tiny store driven by `requestAnimationFrame`. Counting revolutions keeps travel-based animation (the moving ground) continuous across the 360° → 0° wrap; scrubbing stays within the current revolution. Views subscribe through zustand selectors and only update the animated elements, so panels don't re-render 60 times a second. The playhead is shared, so the animation, the height-chart cursor and every future view stay in sync, and scrubbing any view moves all of them.
- All localStorage access goes through `state/storage`, which never throws (private windows, blocked storage).

### 12.7 Rendering

- Everything is SVG: crisp at any zoom, easy hit-testing for editor handles, and native Bézier/arc support.
- Curves are emitted as SVG path `d` strings straight from the Bézier pieces. Data-to-screen mapping is a group transform with `vector-effect: non-scaling-stroke`.
- Animation updates a single `transform` attribute on the foot group (rotate by α, translate to P1) plus the contact marker. Geometry is not regenerated per frame.
- Other feet in the height chart are the same path shifted by kΔ.

### 12.8 Testing

Automated (`npm test`, vitest):

- **Support map:** matches dense brute force on random, often non-convex outlines; the h′ identity; circles and squares (arcs, corners, flat edges); the hull encloses the outline.
- **Kinematics:** the §9 regression values (to 3–6 decimal places); the arc foot's path is a circle of radius L; derivatives vs finite differences; no-slip v vs the finite-difference velocity of a frozen material point; envelope vs the brute-force lowest foot; fitted curves within tolerance; random non-convex feet stay finite.
- **Travel:** X(0) = 0; X(φ + 2π) − X(φ) = ±S_rev and X(φ + Δ) − X(φ) = ±S_step; X′ matches the active foot's v by finite differences.
- **Splines:** Hermite fits within tolerance; exact Bézier conversion.
- **Design:** JSON round trip, readable errors for bad files, older files still open; presets valid with no stance contact jumps; outline edits (insert keeps the shape, delete, smooth handles, arc → cubic); cam sizing.
- **Generator:** see §10.9.
- **Swept area:** a circular foot gives a circle of radius R + L. The result matches a brute-force union of 2000 poses (plus each corner's path), ray by ray from P0, to under 0.001 mm for the default foot, every preset and random feet with an offset pin. A hooked foot is flagged as conservative and matches the brute-force radial hull. The cam's sweep is included where it pokes out. The boundary is closed and counter-clockwise.
- **Mirror:** on by default in canonical form; symmetrising symmetric and random outlines, idempotence, refusing one-sided outlines; mirrored edits from either side; paired insert/delete; analysis unchanged; file round trip.
- **Export:** part layout; SVG uses exact arc and cubic commands; DXF has splines, arcs and mm units.
- **Import:** the sample SolidWorks feet, round trips through the export, the reader, entities, splines, loops, placement, units and smoothing (§14.12).

Checked by hand during development, not automated yet:

- **Performance:** about 2 ms per full analysis (§11.9); the swept area adds 2–7 ms, only when drawn.
- **DXF validity:** an exported file parsed cleanly with an independent reader (dxf-parser).
- **UI:** headless-Chrome scripts at laptop, tablet-landscape and tablet-portrait sizes, in light and dark mode.
- **Offset-slot formula (§4.4):** verified numerically while writing this spec; it gets a unit test when the offset slot is implemented.

---

## 13. UI

Guiding rule: show only what matters while tuning, and keep the rest one click away. Bob, stride and the main smoothness numbers are always visible; secondary results, hardware sizes and shaft speed are in collapsed sections.

**Explanations (ⓘ).** Anything a user might not understand has a small, muted info icon beside its label. That covers results, mechanism and hardware inputs, the Generate brief, each view (beside its title or active tab), the inspector's anchor and edge types, the Fit column, the mode switch and the import options.
- **Opening it:** the explanation (`InfoTip`) opens on hover, on keyboard focus, or on a tap, since tablets have no hover. Escape, a tap elsewhere or leaving the icon closes it.
- **Placement:** it stays inside the window and follows the icon when the page scrolls. Inside a modal dialog it renders inside the dialog, so it shows above the modal.
- **Look:** it uses the theme's own surface and text colours with a border, so it matches light and dark mode.
- **Native hover titles:** used only to name icon buttons and give shortcuts (Undo, Fit, Play), because users don't know they exist and touch screens never show them.
- **Extending:** a new view explains itself with the registry's `info` text. New controls pass `info` to NumberField, Checkbox or SpanField.
- **Wording:** a sentence or two in plain words, saying what the thing is and, where it helps, which way is better.

### 13.1 Layout (desktop; stacks vertically on narrow screens)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Title  Design name  File ▾  ↶ ↷  [Design│Generate] ⓘ        ◐  mm│in  │
├───────────────┬──────────────────────────────┬───────────────────────────┤
│ Mechanism     │ Foot path (animation)         │ Foot editor               │
│ (N, L, pin)   │                               │                           │
│ Results       │                               │                           │
│  Bob │ Stride │ ▶  φ scrubber  speed          │                           │
│  kink, ripple ├──────────────────────────────┴───────────────────────────┤
│ ▸ More results│ Lowest point vs cam angle (all feet + envelope)          │
│ ▸ Hardware    │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
```

The design's name sits next to the app title. The File menu holds New, Open, Import foot (DXF)… (§14.2), Save…, Export SVG and Export DXF. Save… (or ⌘/Ctrl+S) asks for a name. The name is stored in the design, shown next to the app title, and used for file names: `<name>.shuffler.json`, `<name>-parts.svg/.dxf`. Each view's legend and controls sit in its panel header. Canvases zoom with the wheel or a pinch, pan with a drag, and have one Fit button.

**Theme.** The ◐ button (its icon shows the current choice) opens Match the system, Light or Dark. Match the system is the default and follows the device's light or dark setting. A chosen theme is remembered with the other display preferences and set on `<html>` as `data-theme`; `index.html` applies it before the first paint, so the page never flashes the other theme. The dark colour tokens appear twice in `index.css`, once for the system setting and once for the switch, and a test keeps them identical. Everything, tooltips included, draws from the same tokens.

**Shortcuts:** Space plays or pauses; ⌘/Ctrl+Z undoes and ⌘/Ctrl+Shift+Z or Ctrl+Y redoes; ⌘/Ctrl+S opens Save…; in the editor, Delete removes the selected anchor and Escape clears the selection. Apart from ⌘/Ctrl+S, shortcuts are ignored while typing in a text field.

### 13.2 Path view and animation

- Fixed elements: P0 (shaft), Ps (pin), the cam circle (path of P1), and the full lowest-point path C₀(φ) with the stance portion highlighted.
- Animated elements: the cam disc at P1, the foot posed by (P1, α) with its slot, the contact point, and the ground at E(φ).
- The ground is a ruler in the display unit, with ticks hanging below the line:
  - **mm:** every 10 mm and every 1 mm.
  - **in:** like a tape measure, at 1″, ½″, ¼″, ⅛″ and 1/16″ with decreasing length.
  - **Zoom:** finer levels are hidden while they would be less than 2.5 px apart on screen. At the default laptop zoom every level shows.
- The ruler slides with the ground by −X(φ) (§7.4), so it shows the robot's actual no-slip forward motion.
- Swept area (§4.6): everything the foot and cam occupy over a revolution, shaded behind the mechanism with its outline. Anything inside it, in the plane of a foot, can jam the shuffler. If the foot isn't star-shaped about P0, a note says the line is conservative. Off by default; while hidden it isn't computed.
- Header: a legend (path, stance), a "Swept area" toggle that carries its own swatch, and "Show all feet" (both toggles are remembered).
- Footer: the play bar (play/pause, φ scrubber, φ readout, speed). It drives the shared playhead, so the height chart follows it too.

### 13.3 Height chart (y vs φ)

- φ on x (0–360°), y on y (mm).
- N curves in fixed series colours, with the envelope E drawn as a wide grey band underneath (the robot's bob).
- Handoff markers, bob lines (min and max of E, labelled), and a playhead that can be dragged to scrub. Hovering shows every foot's value.
- Header: legend and a Full/Bob range toggle.

### 13.4 Foot editor

- **Pen-tool editing of a closed path.** Drag anchors, handles and arc diamonds. Double-click an edge to insert an anchor (shape preserved). Delete removes the selected anchor.
- **Inspector** for the selection: anchor type (corner / smooth / symmetric), X, Y, r and θ about P1, and Delete; edge type (Bézier / line / arc), arc sweep and Add anchor.
- **Snap to grid:** anchors and handles snap to 0.5 mm, or 1/32 in when showing inches.
- **Overlays (kept minimal):** faint rings about P1, the cam bore, the generated slot, and one blue band on the part of the outline that touches the ground during stance (§5.2.2).
- **Mirror option:** on by default for new designs. Keeps the foot symmetric about its centreline (x = 0). Turning it on keeps the right half and reflects it.
  - The outline is held in a canonical form: counter-clockwise, node 0 is the bottom anchor on the axis, node n/2 the top anchor on the axis, and the left half is the mirror of the right.
  - Every edit is mapped to the right half and the left half is rebuilt (`core/design/mirror.ts`), so editing either side works and the shape is always exactly symmetric.
  - The two axis anchors cannot move sideways or be deleted. When smooth, they keep horizontal handles.
  - The analysis and exports just see an ordinary outline.
- **Header:** presets (kept symmetric when Mirror is on), Mirror, and snap to grid. Later: SVG path import. Generating a whole design is the separate Generate mode (§13.6).

### 13.5 Sidebar

- **Mechanism:** feet, eccentricity L, pin height and offset, each with a slider. A slider drag is one undo step.
- **Issues:** only shown when there are errors or warnings.
- **Results:** tiles for bob and stride per revolution (with stride per step), then handoff kink and speed ripple.
- **More results (collapsed):** cam shaft speed (rpm), ground speed, touchdown speed, peak vertical acceleration, handoff slip, tilt range, foot lift, double support.
- **Hardware (collapsed):** shaft type and size, pin diameter, clearance, minimum wall, and the automatic cam diameter (read-only).

### 13.6 Generate mode ✔

The generator (§10) is a mode of the main window, not a popup.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Title  Design name  File ▾  ↶ ↷  [Design│Generate] ⓘ        ◐  mm│in  │
├───────────────┬──────────────────────────────┬───────────────────────────┤
│ Layout        │ Foot path: candidate         │ Foot (read-only preview)  │
│ Space         │ + space box + swept area     │                           │
│ Goals         ├──────────────────────────────┴───────────────────────────┤
│ ▸ Foot shape  │ [Candidates] Lowest point vs cam angle   [Use this design]│
│ ▸ Hardware    │ Feet  L     Pin    Bob     Stride   Ripple  Fit          │
│               │ 5     8.1   34.5   0.02    102.4    13 %    Ideal  ◀     │
│ [Generate]    │ 4     8.6   29.1   0.13    106.5    20 %    Good         │
└───────────────┴──────────────────────────────────────────────────────────┘
```

- **Entry and exit.** A Design | Generate switch in the header. Generate swaps the sidebar for the brief. *Use this design* applies the selected candidate (mechanism, outline, mirror flag; the design keeps its name) as one undoable step and returns to Design. Switching back to Design without applying leaves the design untouched.
- **The brief.**
  - *Order.* Layout, Space and Goals are open; Foot shape and Hardware are collapsed. Hardware is the design's own section, shared.
  - *Inputs.* Each dimension is Fixed, Range or (where it makes sense) Free. Each goal is Off, Limit ("at most / at least") or Goal (ideal, acceptable, and Low/Normal/High importance), and only its own fields are shown. A Presets menu fills in the goals.
  - *Running.* The Generate button sticks to the bottom of the sidebar and becomes a progress bar with Stop while searching. Reset rebuilds the brief from the current design.
  - *Remembered:* the brief is kept in the browser; saving it in the design file is a later option.
- **Preview in the real views.** The best candidate is selected as soon as it arrives, and selecting a candidate previews it in every view.
  - *Foot path:* the swept area is always on, inside the dashed space box.
  - *Foot editor:* replaced by a read-only Foot preview.
  - *Bottom area:* the height chart stays available as a tab.
  - *Why not a popup:* a popup would repeat these views at a smaller size, and closing it would lose the comparison.
- **Candidates view.** The first tab in the bottom area, with Use this design in its header.
  - *Columns:* feet, L and pin, then only the metrics the brief uses, then a plain verdict. The verdict is Ideal (every goal within 5 % of ideal), Good, Acceptable, or "Misses …" naming the goal, limit, space or ride height it fails.
  - *Order:* best first, and the best design for each feet count is always included.
  - *Interaction:* rows are clickable and keyboard-navigable (arrows, Enter).
  - *Simpler than planned:* the scatter plot and goal bars were dropped for this compact table, in line with keeping the screen uncluttered. "Limited by" explanations remain a later step.
- **Quick iteration.** The brief stays on screen, and a typical search takes 1–2 s, so changing a goal and pressing Generate again is cheap.

---

## 14. Export and import

### 14.1 Export

| Format | Contents | Notes |
|---|---|---|
| **DXF (R2007 / AC1021)** | Foot (outline, bearing hole, slot), cam variants (disc + shaft bore), frame holes (P0 shaft clearance, Ps pin), foot 1's lowest-point path for reference, part labels | Layers FOOT, CAM, FRAME, REFERENCE and LABELS. Lines → LINE, arcs → ARC/CIRCLE, each cubic Bézier → its own degree-3 SPLINE with knots [0,0,0,0,1,1,1,1] (exact). |
| **SVG (mm units)** | Same parts and labels, laid out left to right | Exact cubic and arc path commands; `width`/`height` in mm for correct scale on import. |
| **JSON** | Full `Design` | Native save/open; schema-versioned (see §12.3 for compatibility). |

**Cam variants.** Each cam's shaft bore is rotated by its phase kΔ. On a hex shaft, phases that are multiples of 60° reuse the same part: N = 3 needs one cam design (mounted rotated), N = 4 needs two variants, N = 5 needs five. The exporter emits the distinct variants with labels.

Files are named after the design: `<name>.shuffler.json`, `<name>-parts.svg`, `<name>-parts.dxf`. Browsers save downloads to their usual location.

Future: STEP via OpenCascade (heavy, deferred), CAD parameter tables (Fusion/Onshape variables), outline import from SVG (the DXF import pipeline below takes plain segments after reading the file, so an SVG reader plugs in there).

### 14.2 DXF import: overview ✔

Status: built (`core/import`, File ▸ Import foot (DXF)…). Values marked *tune* are starting points, checked so far against the two SolidWorks sample feet in `docs/` (§14.12).

File ▸ **Import foot (DXF)…** reads a foot drawn in CAD and replaces the design's foot outline. A DXF is a drawing, not a design file: it says nothing about the feet count, the shaft or the RPM. The full round trip stays Save/Open (`.shuffler.json`).

Principles:
- **Only the outline is imported as geometry.** The bore and slot are generated from L, the pin and the hardware (§12.3). The file's bore and slot are used to *place* the foot and to *cross-check* the mechanism, never copied.
- **Exact where possible.** Lines, arcs, circles, bulge polylines and non-rational splines of degree ≤ 3 convert exactly to the outline's segments (§11.2). Anything else is fitted to 0.001 mm, and the import says so.
- **Never guess silently.** Every import goes through a preview dialog (§14.10). Where the tool had to guess (units, which shape is the foot, orientation), the guess is shown next to the control that changes it. A clean file needs one click.
- **One undo step.** Import replaces the outline and the mirror flag (and L and the pin, if chosen, §14.8). It keeps the design's name, clears the editor selection, and returns to Design mode if Generate was open.

Stages (pure core code; when an option changes, the dialog re-runs stages 3–7 without re-reading the file):

1. **Read:** text → entities (§14.3).
2. **Interpret:** entities → flat segments in mm (§14.3, §14.4).
3. **Chain:** segments → closed loops (§14.5).
4. **Pick:** which loop is the foot, and which holes are the bore and slot (§14.6).
5. **Place:** rigid transform into the foot frame (§14.7).
6. **Reconcile:** compare the file's slot and bore with the design (§14.8).
7. **Build:** segments → editable outline, with clean-up, smoothing and mirror detection (§14.9).

### 14.3 Reading the file

**Parser.** A small reader of our own in `core/import/dxf`, not a dependency. ASCII DXF is a flat list of (group code, value) line pairs, so the reader is short. The real work (coordinate systems, splines, blocks) would be ours with any parser. It stays pure TypeScript, tested, and loaded on demand like the DXF writer.

| File | Handling |
|---|---|
| ASCII DXF, R12 to R2018 | Supported. Sections used: HEADER ($INSUNITS), TABLES (layers), BLOCKS, ENTITIES. |
| Binary DXF (starts `AutoCAD Binary DXF`) | Error: "This is a binary DXF. Export it as ASCII DXF." |
| DWG (starts `AC10`) | Error: "This is a DWG file. Export it as DXF." |
| Anything else, empty, or no ENTITIES section | Error: "This isn't a DXF file." |
| Truncated (no EOF) | Uses what was read if the entity list is intact; otherwise an error with the line number. |
| CRLF or LF line ends, padded group codes | Trimmed. |
| Text encoding | UTF-8 (R2007+), falling back to Windows-1252 for older files. Only layer and block names are text. |
| Over 20 MB or 200 000 entities (*tune*) | Error: "This looks like a whole drawing. Export just the foot." |
| Non-finite numbers | That entity is dropped and counted. |

**Entities.**

| Entity | Becomes | Notes |
|---|---|---|
| LINE | line | |
| ARC | arc | Degrees, counter-clockwise in the entity's own coordinate system (OCS, below). Angles may be negative or over 360°, so the sweep is (end − start) mod 360°. |
| CIRCLE | two half arcs | An outline needs at least two anchors. A round foot is a valid outline (constant r). |
| LWPOLYLINE | lines and arcs | Bulge (code 42) is tan(sweep/4), the same convention as the outline's arc edges, so it maps directly. The closed flag (code 70, bit 1) or a repeated first vertex closes it. Widths are ignored. |
| POLYLINE + VERTEX (R12) | lines and arcs | 2D only. Curve-fit and spline-fit polylines use their fitted vertices and skip spline frame points (vertex flag 16). The result is usually faceted (§14.9). 3D polylines and meshes are ignored. |
| SPLINE | cubics, lines or arcs | See below. |
| ELLIPSE | an arc if the ratio is 1, otherwise cubics | An ellipse is an affine image of a circle, and Béziers are affine-invariant, so the circle approximation is applied in parameter space with pieces short enough to stay within 0.001 mm. |
| INSERT | its block's entities, transformed | Insertion point, block base point, x/y scale (negative = mirrored), rotation, row/column arrays and nested blocks. Depth limit 16, with cycle detection. A non-uniform scale turns arcs into elliptical arcs. Entities on layer 0 inside a block take the INSERT's layer. A missing block is skipped and noted. |
| TEXT, MTEXT, DIMENSION, LEADER, HATCH, POINT, SOLID, IMAGE, VIEWPORT | ignored | Counted by type in the dialog's notes. Dimension blocks (`*D…`) are never expanded. |
| REGION, 3DSOLID, BODY | ignored | Their geometry is encrypted ACIS data. If that is all there is: "The drawing stores the shape as a solid. Export a sketch or flat profile instead." |

**Splines.** The reader takes the degree, knots, control points, weights, fit points, end tangents and flags (closed, periodic, rational).
- *Non-rational, degree ≤ 3: exact.* Knot insertion (Boehm) up to full multiplicity splits the spline into Bézier pieces. Degree 1 pieces become lines; degree 2 pieces are degree-elevated to cubics. Our own export writes each cubic as its own spline with knots [0,0,0,0,1,1,1,1], so it comes back unchanged.
- *Rational, degree 2.* CAD often writes circles and arcs this way. A piece with equal legs and a normalised middle weight of cos(half the sweep) is a circular arc and becomes an exact arc.
- *Everything else* (other rational pieces, degree > 3): fitted with the adaptive cubic Hermite fit (§11.6) from exact NURBS points and derivatives (de Boor) to 0.001 mm, split wherever a knot's multiplicity allows a corner. Noted as approximated.
- *Fit points only* (no control points): a cubic spline through the points, with chord-length parameters and the file's end tangents if present. CAD programs don't agree on this curve between the points, so it is noted as approximated.
- Periodic (unclamped) knot vectors are evaluated over their valid range. An invalid knot vector (wrong count, decreasing) drops the entity, with a note. If all weights are equal, the spline is treated as non-rational whatever the flag says.

**Coordinate systems.** ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE and INSERT are stored in an object coordinate system (OCS) set by their extrusion vector (codes 210/220/230) through DXF's arbitrary-axis rule. ELLIPSE and SPLINE are in world coordinates, but an ellipse's angles still run around its extrusion vector.
- Extrusion (0, 0, −1) is common (mirrored sketch geometry). It negates x: arcs run clockwise in world coordinates and bulge signs flip. Getting this wrong draws arcs on the wrong side, so it gets its own tests.
- An extrusion tilted out of the XY plane means the entity isn't flat in XY. It is skipped, with a note.

**Z.** Coordinates are projected onto XY. If the chosen outline's entities sit at different heights, a note says "The outline isn't flat; it was projected onto XY."

**Spaces and layers.**
- Model space only. Entities with code 67 = 1 are in paper space (title blocks, sheet borders). If model space has no usable geometry but paper space does, paper space is used, with a note.
- Entities on layers that are off or frozen are skipped by default, since they are usually construction geometry. The notes list them, with a toggle to include them.
- A layer named FOOT (any case) is used on its own when it holds a closed outline. Our own exports then import their foot directly, and users can name a layer FOOT to skip choosing.

### 14.4 Units

$INSUNITS gives the drawing unit. Supported: 1 in, 2 ft, 4 mm, 5 cm, 6 m, 9 mil, 13 µm. Everything converts to mm before chaining, so all tolerances below are in mm.

- **Declared and plausible:** used. Plausible means the foot's largest dimension is 5–1000 mm (*tune*).
- **Declared but implausible:** used, with a warning that shows the alternative: "This foot is 2.9 mm wide. Was it drawn in inches? It would be 73.7 mm." Some exporters write the wrong header.
- **Missing or unitless (0):** guessed. If a circular hole matches the design's bore radius within 2 % in one unit, that unit wins. Otherwise mm, unless only inches give a plausible size.
- The dialog always shows the unit (a dropdown) and the resulting size, so a wrong guess is visible and takes one click to fix. Nothing is ever scaled to fit.

### 14.5 Finding closed outlines

DXF stores each line and arc separately, in any order and direction. Closed loops are rebuilt from shared endpoints, found through a spatial hash (linear time).

| Case | Handling |
|---|---|
| Ends within 0.002 mm (*tune*) | Joined silently (CAD rounding). |
| Gap of 0.002–0.05 mm (*tune*) | Closed: both ends move to their midpoint. A line moves exactly; an arc keeps its sweep; a cubic moves its handle with its end. Noted: "Closed 2 small gaps (largest 0.03 mm)." |
| Larger gap | The loop stays open, and its open ends are marked in the preview. If every open end has a partner within 1 mm, the dialog offers "Close gaps up to 0.4 mm". |
| Exact duplicates (either direction, any layer) | Dropped and counted. Common in laser and CAM files. |
| Overlapping collinear lines, overlapping arcs on the same circle | Merged before chaining. |
| Zero-length entities, slivers under 0.002 mm | Dropped. |
| Open chains (centre lines, construction lines, our export's reference curves) | Pruned from their free ends, repeatedly. Listed in the notes and drawn faintly in the preview. |
| Junctions (three or more ends at one point after pruning) | Each connected group keeps only its outer boundary, traced by always taking the outermost edge at a junction. Internal lines (such as a construction line across the foot) are dropped, with a note. |
| Crossings in the middle of entities (untrimmed sketch) | Not split. If the result crosses itself, the preview shows it, and the usual "outline crosses itself" error (§15) applies after import. The fix is to trim the sketch in CAD. |

**Nesting.** Closed loops are nested by containment (point in polygon on the flattened loops) with the even-odd rule: a loop at even depth is a part outline, one at odd depth is a hole in it. Depth 2 covers small parts nested inside another part's hole on a cutting sheet.

### 14.6 Choosing the foot and its holes

**Which part.**
1. The FOOT layer alone, if it has a closed outline (§14.3).
2. Otherwise each part is scored. A circular hole with an obround hole whose axis passes through it scores highest, then a circular hole, then size.
3. If one part clearly wins, it is selected. If not (several identical feet on a sheet, or no holes at all), the best guess is selected and the dialog asks the user to click the foot. Clicking another part always switches to it.

**Bore.** A hole that is a full circle: one CIRCLE, arcs with one centre and radius adding up to 360°, or a faceted polygon whose vertices fit a circle within 1 % of its radius (*tune*). If several qualify, the bore is the one the slot's axis passes through, else the largest. A bore with a keyway or a flat isn't a circle, so it counts as no bore.

**Slot.** A hole that is an obround: two parallel lines of equal length and two half arcs of the same radius (exact or faceted). It gives the slot's axis, centre, half-width and length.
- If the axis misses the bore centre by more than 0.05 mm or 0.5° (*tune*), the slot is offset or angled. Only the centreline slot exists so far (§4.3), so it is used for orientation only (bore → slot centre), with a note: "The slot is 1.8 mm off the bore's centreline; this tool models a centreline slot."
- A curved slot is not recognised. It counts as another hole and is noted.

**Other holes** (lightening holes, bolt holes, engraved text cut as outlines) are not part of the model. They don't change the contact or the swept area (§4.6), but the wall checks (§15) don't see them, and exports won't include them. Note: "3 other holes aren't modelled and won't be in exports. Keep them in your CAD file." (Possible later: carry them through as fixed cut-outs, §17.)

### 14.7 Placing the foot

The outline must end up in the foot frame at neutral (§3.1): P1 at the origin, centreline vertical, slot above. Every placement is rigid (translation, rotation, optional reflection) plus the unit scale, so lines, arcs and cubics stay exact.

| Found | P1 | Centreline |
|---|---|---|
| Bore and slot | Bore centre | Bore → slot centre is +y. Nothing to adjust. |
| Bore only | Bore centre | The outline's mirror axis, if it has one through P1 (the candidates are its principal axes), else the drawing's +Y. Of the two directions along the axis, the one nearer the drawing's +Y. |
| Neither | The drawing origin if it is inside the outline; otherwise the user clicks P1 in the preview (snapping to arc centres) | As above. |

When no slot fixed the centreline, the dialog shows Rotate (±90° buttons and an angle field). For asymmetric feet it also shows **Flip**, for a foot drawn from the other side or for the robot's other module (the robot travels toward −x, §3.1). The preview draws the design's own bore and slot faintly at the result, so a wrong orientation is obvious.

### 14.8 Slot and bore vs the design

When a slot and bore are found, the file implies part of the mechanism (§4.5):

| In the file | Implies |
|---|---|
| Distance from P1 to the slot centre | pin distance \|Ps − P0\| |
| Slot length − slot width | 2L (if the slot was drawn exactly to length) |
| Slot width / 2 | slot radius = pin radius + clearance |
| Bore radius | cam radius + clearance (derived from L, the shaft and the minimum wall, §12.3) |

- **All within 0.05 mm of the design:** nothing to show.
- **Otherwise** the dialog shows the two side by side (File | This design) with a choice:
  - **Use the file's slot** (the default, §17). The pin distance comes from the slot centre (the pin keeps its direction), L from the slot length, and the pin diameter from the slot width with the design's clearance kept. The analysis then describes the physical foot.
  - **Keep this design's mechanism:** outline only. The generated slot may then hit the walls, which validation reports as usual.
- If the slot was drawn with extra room at the ends, L inferred from its length comes out too large. The number is shown so the user can check it.
- The bore can't be adopted, because its size follows from L, the shaft and the minimum wall. If it still differs after adopting L, a note says so: "Your bore is 15.0 mm; this design's is 16.2 mm. The tool's bore is used in the analysis and exports."
- Feet count, shaft, pin direction and RPM are not in a foot drawing and never change.

### 14.9 Building the editable outline

Segments become nodes and edges (§12.3): a node at each segment's start; lines become line edges; arcs become arc edges with bulge tan(sweep/4); cubics become cubic edges with handles from their control points.

- **Node modes.** Smooth where two cubics meet with collinear handles (within 0.1°), otherwise corner, as the generator does (§10.8). Tangent line–arc joints stay corners in the editor; the contact math reads smoothness from the geometry, not the mode (§11.3).
- **Merging.** Consecutive collinear lines become one line, and consecutive arcs with the same centre and radius become one arc (CAD often splits circles into quadrants). Both are exact.
- **Faceted curves.** Laser, CAM and drawing tools (and R12 spline-fit polylines) often export curves as hundreds of short lines. Every facet vertex is then a convex corner the foot rocks over. That gives corner contacts and contact jumps in stance (§15 warnings), a jagged path and noisy bob, plus hundreds of anchors that slow editing and analysis.
  - *Detection:* 8 or more consecutive lines, each turning less than 15° and shorter than 10 % of the foot's size (*tune*). The limit is relative because flat bottoms exported to a chord tolerance get long facets: 6 mm at a 500 mm radius and 0.01 mm tolerance. Collinear lines are merged first, so a straight edge drawn in pieces isn't mistaken for facets.
  - *Fix:* **Smooth faceted curves**, on by default when detected (§17). Each run is refitted with cubic Béziers that pass within 0.02 mm of the facet vertices, which lie on the original curve. Real corners (turns over 15°) and long straight lines are kept. Where the run turns one way only, each fitted cubic must have no inflection (the exact B′ × B″ test from §10.8); otherwise it is split and refitted, so smoothing never invents contact jumps.
  - Note: "Smoothed 3 faceted curves (412 lines → 18 curves, within 0.02 mm)." Unticking it keeps the facets as drawn.
- *Later:* **dense splines** (hundreds of control points, from a scan or a curve fit) could get the same refit, offered as **Simplify curves** when the outline would have over 60 anchors. For now they import as one cubic per knot span.
- **Size.** Over 400 anchors after clean-up: a warning that editing and analysis will be slow.
- **Mirror.** After placement, the outline is compared with its reflection about x = 0.
  - Within 0.005 mm: Mirror turns on through `symmetrize` (§13.4), which moves the shape by at most that much.
  - Within 0.2 mm: the dialog offers "Make symmetric (differs by up to 0.08 mm)", unticked.
  - Otherwise Mirror is off.
- Direction (CW or CCW) and the starting node don't matter: the analysis orients the outline (§11.3), and `symmetrize` builds the canonical form.

### 14.10 The import dialog

```
┌ Import foot ─────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────────────────┐ │
│ │ preview: other shapes faint, the foot solid,         │ │
│ │ P1 cross, this design's bore and slot ghosted,       │ │
│ │ open ends and crossings marked                       │ │
│ └──────────────────────────────────────────────────────┘ │
│ foot.dxf · 60.0 × 98.6 mm · 18 anchors · symmetric       │
│ Units [mm ▾] from the file                               │
│ Slot  [Use the file's | Keep this design's]              │  ← only on a mismatch,
│        File      This design                             │    with the numbers
│ Pin    36.00 mm  40.00 mm   (also L and slot width)      │
│ Rotate [↺] [↻] Angle [0.0°]                              │  ← only when no slot fixes it
│ [ ] Flip left to right                                   │  ← only for asymmetric feet
│ [✓] Smooth faceted curves (288 short lines)              │  ← only when detected
│ [ ] Make symmetric · [ ] Include hidden layers           │  ← only when relevant
│ After import: Foot wall around the slot is 0.80 mm …     │  ← only if any errors
│ ▸ 2 notes                                                │
│                                     [Cancel]  [Import]   │
└──────────────────────────────────────────────────────────┘
```

- Only the controls a file needs appear (§13's guiding rule). A clean file shows the preview, one summary line, Units and Import.
- The preview pans and zooms like the other canvases. Clicking a part selects it, or places P1 when there is no bore (snapping to arc centres within 10 px). Red markers show open ends only when they are why nothing closes; loose construction lines are just drawn faint. Sizes use the display unit (mm or in), and the controls sit under the preview at every size.
- The dialog and the reader load on demand (about 18 kB gzipped), like the DXF writer.
- "After import" analyses the design as it would be (about 2 ms) and lists its errors, so problems show before importing. Import is still allowed: the result is an ordinary design to fix in the editor.
- Notes (collapsed): ignored entities by type, skipped hidden layers (one toggle includes them), gaps closed, duplicates removed, approximated curves, other holes, an offset slot, the bore difference.
- Later: drag a DXF onto the Foot editor.

### 14.11 Errors

Import stops, and the dialog says why in plain words, only when:
- the file is not a DXF, or is a DWG or a binary DXF;
- it has no usable geometry (only text, dimensions or solids);
- everything is on hidden layers (the toggle is offered);
- there is no closed outline (the preview marks the open ends in red, and offers to close gaps when every open end has a partner within 1 mm);
- the file is over the size limit.

Everything else imports, with notes.

### 14.12 Code layout and tests

```
src/core/import/        pure TypeScript, loaded on demand
  dxf/reader.ts         text → group-code pairs → header, layers, blocks, entities
  dxf/entities.ts       entities → flat segments (OCS, blocks, ellipses, polylines)
  dxf/nurbs.ts          Bézier extraction by blossoms, rational-arc test, fitted fallback, fit points
  segments.ts           affine maps, exact segment transforms, endpoint moves, merging
  loops.ts              overlaps and duplicates, endpoint graph, gaps, pruning, outer boundaries, nesting
  features.ts           circle and obround detection (exact and faceted), bore and slot pairing
  place.ts              rigid placement, mirror-axis search, symmetry error
  simplify.ts           faceted-run detection, convexity-safe cubic refit
  toOutline.ts          segments → Outline (modes, merging, long arcs split)
  units.ts              $INSUNITS table, plausible sizes
  importFoot.ts         runs the stages; returns parts, choices, placement, notes and the new design
src/ui/layout/ImportDialog.tsx (+ importDialog.module.css), and importFootDxf in fileActions
src/core/test/dxf.ts    builds small DXF files for tests
```

Everything after `dxf/entities.ts` takes plain segments, so a later SVG reader plugs in there.

Tests (`dxf/dxf.test.ts`, `import.test.ts`):
- **Sample feet:** `docs/test_foot_1.DXF` and `test_foot_2.DXF`, exported from SolidWorks (R2000, CRLF, mm, everything on layer 0, two watermark MTEXTs). Lines, arcs and one CIRCLE; the bore is at (0, 7), not the origin. Both give L = 8 and a pin distance of 36 from the slot, Mirror on, and a 7.004 mm slot. The file's bore (Ø35.40) is larger than the tool's Ø30.04, which the notes explain. The plain foot has no issues. The pronged foot (three prongs on the r = 80 bottom) shows corner-contact and contact-jump warnings, as it should: it rocks from prong to prong.
- **Round trip:** each preset and an asymmetric foot go through `exportDxf` and back, with the rest of the parts sheet present. The result is the same outline to 10⁻⁶ mm (the precision of the nearest-point check), with the same mirror flag and the same bob and stride.
- **Reader:** binary, DWG, non-DXF and damaged input give their messages. CRLF line ends, padded codes, a missing EOF and a byte-order mark are all read. Units and off or frozen layers are read.
- **Entities:** bulge polylines, R12 POLYLINE/VERTEX (spline frame points skipped), arcs extruded along −Z (clockwise in world coordinates), a tilted extrusion skipped, INSERT with base point, rotation, mirroring and layer inheritance, block cycles and missing blocks, ignored types counted, and ellipses (exact arcs at ratio 1, within 0.001 mm otherwise).
- **Splines:** each piece of a clamped or unclamped spline of degree 1–3 matches de Boor evaluation at the same parameter to 10⁻⁹ mm. A rational quadratic circle comes back as four exact arcs. Degree 5 and general rational splines fit within 0.001 mm. Fit points are interpolated through. Invalid knots are rejected.
- **Loops:** shuffled and partly reversed entities give the same loops. Also even-odd nesting to depth 2, overlapping collinear lines, overlapping arcs across 0°, duplicates, an internal line, a loose line, small gaps closed, and larger gaps offered.
- **Placement and units:** rotation, mirroring and translation are undone from the bore and slot. Flip restores an asymmetric foot drawn mirrored. P1 comes from the origin, or is picked when the origin is outside. An offset slot is reported. Several feet on a sheet are ambiguous until one is picked. Inches come from $INSUNITS, or are guessed from the bore. A wrong declared unit gets a warning.
- **Smoothing and symmetry:** a foot flattened to 64 facets per curve comes back within 0.02 mm of the true outline, with a quarter of the anchors or fewer and no stance warnings; unsmoothed, it rocks on corners. A foot that is 0.05 mm off symmetric is offered Make symmetric. A bore drawn as a 72-gon is recognised.
- **UI:** checked by hand with headless Chrome: both sample feet imported through the menu, two feet on a sheet (picking the other), a faceted unitless inch file at tablet-portrait size in dark mode, and an open outline (Close gaps, then picking P1).
- **Still to do:** more real files, from Fusion 360, Onshape, FreeCAD, Inkscape and a laser-cutting service.

Out of scope for now: DWG and binary DXF, 3D geometry, trimming or extending untrimmed sketches, importing extra holes as geometry, importing cams or frame plates, and kerf-offset cutting files (import the nominal profile).

---

## 15. Validation rules

| Check | Rule | Level |
|---|---|---|
| Feet | whole number from 2 to 8 | error, blocks analysis |
| Eccentricity | L > 0 | error, blocks analysis |
| Mechanism | \|Ps − P0\| > L (otherwise the foot cannot follow the cam) | error, blocks analysis |
| Outline | at least two anchors and a non-zero area | error, blocks analysis |
| Outline | no self-intersections | error |
| Bore wall | P1 inside the outline, and wall around the bearing hole ≥ min wall | error |
| Slot wall | slot inside the outline, and wall around it ≥ min wall | error |
| Slot vs bore | (\|Ps − P0\| − L) − (r_pin + clearance) − bore radius ≥ min wall | error |
| Cam disc | none needed: sized automatically (§12.3) | – |
| Stance contact | contact jump or corner contact during stance | warning |
| Double-support scrub | double support > 1 % of the cycle and handoff slip > 0.01 mm/rad | warning |
| Constraint lock-up | F_α away from 0, for general slot constraints | future |

Blocking errors stop the analysis, and the views show a message instead of results. Other errors are listed, but results are still shown.

---

## 16. Roadmap

1. ~~**Core math:** curves, preprocessing, support map, centreline constraint, contact, events, Hermite fitting, envelope, motion, metrics. Property and regression tests (§12.8).~~ Done.
2. ~~**App skeleton:** stores, layout, parameters and metrics panels, path view + animation, height chart, playhead, arc-foot preset.~~ Done.
3. ~~**Foot editor:** pen tool, overlays and bands, validation, undo/redo, autosave.~~ Done.
4. ~~**Export/import:** JSON, SVG, DXF (with cam variants and frame holes).~~ Done.
5. ~~**Polish:** simplified UI (secondary results and hardware collapsed), automatic cam size, mirror editing, named saves.~~ Done.
6. ~~**Swept area:** keep-out outline in the path view (§4.6, §11.10).~~ Done. Export as a reference layer is a natural follow-up.
7. **Next:** forward-motion view (X(φ), v(φ)), full-module animation with moving ground, offset/angled slot constraint.
8. ~~**Generator (§10, §13.6):** core (profile, LP, closure, verification), search in a worker, Generate mode UI.~~ Done.
   *Later:*
   - "limited by" explanations from the LP's dual values;
   - offset and curved slots as outer variables, to reduce ripple;
   - goals in time units (RPM), plus acceleration and swept-size goals;
   - saving the brief with the design file.
9. **Later:** curved slots, design comparison, loads.
10. ~~**DXF foot import** (§14.2–14.12).~~ Done.
    *Later:* simplifying dense splines, dragging a DXF onto the editor, carrying extra holes through as cut-outs, SVG import.

## 17. Decisions and open questions

Decided (2026-10-20):

- **Units:** mm internally, with a mm/in toggle in the UI.
- **Direction:** a fixed convention (cam CCW, robot travels −x); see §3.1.
- **Smoothness:** reported as components only.
- **Robot model:** 2D, with both modules in sync and the body parallel to the ground.
- **UI density:** only what matters while tuning is visible (bob, stride, handoff kink, speed ripple). Secondary results, hardware and shaft speed sit in collapsed sections.
- **Cam size:** derived, not an input. The cam radius is L + shaft hole + minimum wall, so the minimum wall doubles as the cam's margin around the shaft.
- **Mirror:** optional, on by default for new designs, and saved with the design. Files without the flag open unmirrored so their geometry never changes. Turning it on keeps the right half; mirrored outlines use the canonical form in §13.4.
- **Saving:** Save… asks for a name, which is stored in the design and used for every file name.
- **Generator (§10):** a Design | Generate mode switch in the main window (not a popup); goals as Off / Limit / Goal with ideal, acceptable and importance; HiGHS in a worker, loaded on demand; space described as a box around the shaft; convex contact profiles only (confirmed by the user, 2026-10-20).
- **Swept area:** exact outer boundary of the foot's sweep (plus the cam's), computed from the envelope condition rather than by sampling poses. If a foot isn't star-shaped about P0, the line falls back to the radial hull, which is never smaller than the true area.

Decided (2026-10-24), for DXF import (§14.2):

- **Only the outline is imported as geometry.** The file's bore and slot place the foot and cross-check the mechanism.
- **Slot mismatch:** by default the file's slot sets L, the pin distance and the pin diameter, so the analysis describes the physical part. "Keep this design's" imports the outline only.
- **Other holes:** reported and left out (not modelled, not exported). Carrying them through as cut-outs is a later option.
- **Faceted curves:** smoothed by default, with a tickbox to keep them as drawn.

Still open:

1. **Default design:** the app opens with the §9 worked example. Should it be a different weight class or scale?
2. **Left/right phasing:** analysing modules out of sync (roll, steering) is deferred.
3. **DXF import, more real files:** so far only SolidWorks exports have been tried. Files from other CAD and laser tools would test the values marked *tune* (§14.12).

## 18. References

- Absolute Chaos Robotics, "Experimentation in Shufflers" (2023): two-cam, pinned-slot single-cam and compliant single-cam designs. https://absolutechaosrobotics.wordpress.com/2023/08/11/experimentation-in-shufflers/
- DigiKey Maker.io, "How to Make a Robot Shuffler Mechanism" (2024). https://www.digikey.com/en/maker/tutorials/2024/how-to-make-a-robot-shuffler-mechanism
- BattleBots Wiki, "Shufflebots". https://battlebots.fandom.com/wiki/Shufflebots
- Robot Wars Wiki, "Walkerbots". https://robotwars.fandom.com/wiki/Walkerbots
- SPARC Robot Construction Specifications v1.6 (shuffler/walker definitions). https://sparc.tools/SPARC_Robot_Construction_Specifications_v1.6.pdf
- NHRL Wiki, "Chonkiii" (shuffler build example). https://wiki.nhrl.io/wiki/index.php/Chonkiii
