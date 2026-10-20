# Shuffler Geometry Builder: Spec, Math & Architecture

Status: v1 implemented (see the README for running and extending). Last updated 2026-10-20.

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
- **Export/import:** CAD-ready geometry (DXF, SVG) and a native design file (JSON) that round-trips, saved under a user-chosen name.
- **Future views** (must be easy to add): forward displacement/speed vs φ, full-module animation (all feet + moving ground), swept envelope of the foot, pin/slot loads, design comparison, optimiser.

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

## 10. Inverse design (future feature) ✔

The support-function form can be inverted. Suppose we want a perfectly flat stance, y₀(φ) = −c on a window W slightly wider than Δ (the overlap gives soft touchdown). §5.1 then requires

$$h\bigl(\psi(\varphi)\bigr) = P_{1y}(\varphi) + c,\qquad \varphi\in W .$$

α(φ) is monotone on W (W lies between the tilt extrema of §4.3), so φ(ψ) can be inverted and h(ψ) is known on the stance band. The bottom profile then follows exactly from q\*(ψ) = h n + h′ n′. It is buildable if and only if ρ = h + h″ > 0 (convex).

Example (§9 parameters, c = 56, W = stance ± 10°): ψ spans 15.3° and the minimum radius of curvature is about 403 mm, a nearly flat bottom. The tool would fit this exactly-defined curve with Béziers to tolerance and blend it into the user's sides with C1/C2 continuity.

This flattens bob but leaves speed ripple. Reducing ripple too needs a second design function: the slot shape (§4.4), which reshapes α(φ). That is a constrained problem, because the pin path must retrace itself, so it belongs with the future optimiser.

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
    design/            schema, defaults, presets, hardware (derived sizes), validate,
                       outlineEdit (free edits, OutlineOps), mirror (symmetric editing), serialize
    export/            parts (sheet layout, cam variants), svg, dxf
    util/              lazy, memoizeLast
    test/              shared test helpers (seeded PRNG, random outlines, finite differences)
  state/               designStore (undo/redo, gestures, autosave), uiStore (preferences, editor selection,
                       notices, open dialog), playhead (shared φ + rAF loop), storage (safe localStorage), useAnalysis
  ui/
    common/            Button, Icon, NumberField, SegmentedControl, Select, Checkbox, Menu, Dialog, Panel, Section
    plot/              Viewport (pan/zoom world view) + viewportContext, Legend, ticks, paths
    views/             types, registry, ViewArea, palette, path/PathView, height/HeightChart,
                       editor/ (FootEditor, EditorCanvas, Inspector, Overlays, useOutlineOps, useWorldDrag),
                       shared/ (MechanismGlyphs, GroundRuler, Transport)
    panels/            ParametersPanel (Mechanism, Hardware), MetricsPanel (Results, More results), IssuesPanel
    layout/            AppShell, Header, SaveDialog, fileActions
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
}
```

- **New slot geometry:** implement `TiltConstraint`, add its spec to the `ConstraintSpec` union and a factory in `constraints/registry.ts`, and add its parameters to the Mechanism section. Only the centreline slot exists today, so there is no constraint picker yet.
- **New segment type:** implement eval/derivatives/split/export in `curves/segment` and a `ContactPiece` producer in `curves/contactPieces`.
- **New editing behaviour** (like Mirror): implement `OutlineOps`; the editor calls whichever ops the design's mode selects (`outlineOps(mirror)`).
- **New visualisation:** add a `ViewDefinition` to `ui/views/registry.ts`. It reads `Analysis` and the playhead hook.
- **New metric:** add it to `Metrics` and `computeMetrics` in `analysis/metrics`, then show it in `ui/panels/MetricsPanel` (Results for headline numbers, More results for the rest).

### 12.6 State and playhead

- `designStore` (zustand) holds the design and its undo/redo history. A slider or drag gesture is merged into one undo entry. It autosaves to localStorage (debounced).
- `uiStore` holds display preferences (units, show all feet, show swept area, snap, chart range; persisted), the editor selection, notices and the open dialog.
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
- **Swept area:** a circular foot gives a circle of radius R + L. The result matches a brute-force union of 2000 poses (plus each corner's path), ray by ray from P0, to under 0.001 mm for the default foot, every preset and random feet with an offset pin. A hooked foot is flagged as conservative and matches the brute-force radial hull. The cam's sweep is included where it pokes out. The boundary is closed and counter-clockwise.
- **Mirror:** on by default in canonical form; symmetrising symmetric and random outlines, idempotence, refusing one-sided outlines; mirrored edits from either side; paired insert/delete; analysis unchanged; file round trip.
- **Export:** part layout; SVG uses exact arc and cubic commands; DXF has splines, arcs and mm units.

Checked by hand during development, not automated yet:

- **Performance:** about 2 ms per full analysis (§11.9); the swept area adds 2–7 ms, only when drawn.
- **DXF validity:** an exported file parsed cleanly with an independent reader (dxf-parser).
- **UI:** headless-Chrome scripts at laptop, tablet-landscape and tablet-portrait sizes, in light and dark mode.
- **Offset-slot formula (§4.4):** verified numerically while writing this spec; it gets a unit test when the offset slot is implemented.

---

## 13. UI

Guiding rule: show only what matters while tuning, and keep the rest one click away. Bob, stride and the main smoothness numbers are always visible; secondary results, hardware sizes and shaft speed are in collapsed sections.

### 13.1 Layout (desktop; stacks vertically on narrow screens)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Title  Design name  File ▾  ↶ ↷                                   mm│in  │
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

The design's name sits next to the app title. The File menu holds New, Open, Save…, Export SVG and Export DXF. Save… (or ⌘/Ctrl+S) asks for a name. The name is stored in the design, shown next to the app title, and used for file names: `<name>.shuffler.json`, `<name>-parts.svg/.dxf`. Each view's legend and controls sit in its panel header. Canvases zoom with the wheel or a pinch, pan with a drag, and have one Fit button.

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
- **Header:** presets (kept symmetric when Mirror is on), Mirror, and snap to grid. Later: the inverse-design "flat stance" generator (§10) and SVG path import.

### 13.5 Sidebar

- **Mechanism:** feet, eccentricity L, pin height and offset, each with a slider. A slider drag is one undo step.
- **Issues:** only shown when there are errors or warnings.
- **Results:** tiles for bob and stride per revolution (with stride per step), then handoff kink and speed ripple.
- **More results (collapsed):** cam shaft speed (rpm), ground speed, touchdown speed, peak vertical acceleration, handoff slip, tilt range, foot lift, double support.
- **Hardware (collapsed):** shaft type and size, pin diameter, clearance, minimum wall, and the automatic cam diameter (read-only).

---

## 14. Export and import

| Format | Contents | Notes |
|---|---|---|
| **DXF (R2007 / AC1021)** | Foot (outline, bearing hole, slot), cam variants (disc + shaft bore), frame holes (P0 shaft clearance, Ps pin), foot 1's lowest-point path for reference, part labels | Layers FOOT, CAM, FRAME, REFERENCE and LABELS. Lines → LINE, arcs → ARC/CIRCLE, each cubic Bézier → its own degree-3 SPLINE with knots [0,0,0,0,1,1,1,1] (exact). |
| **SVG (mm units)** | Same parts and labels, laid out left to right | Exact cubic and arc path commands; `width`/`height` in mm for correct scale on import. |
| **JSON** | Full `Design` | Native save/open; schema-versioned (see §12.3 for compatibility). |

**Cam variants.** Each cam's shaft bore is rotated by its phase kΔ. On a hex shaft, phases that are multiples of 60° reuse the same part: N = 3 needs one cam design (mounted rotated), N = 4 needs two variants, N = 5 needs five. The exporter emits the distinct variants with labels.

Files are named after the design: `<name>.shuffler.json`, `<name>-parts.svg`, `<name>-parts.dxf`. Browsers save downloads to their usual location.

Future: STEP via OpenCascade (heavy, deferred), CAD parameter tables (Fusion/Onshape variables), outline import from SVG/DXF.

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
6. **Next:** forward-motion view (X(φ), v(φ)), full-module animation with moving ground, offset/angled slot constraint.
7. ~~**Swept area:** keep-out outline in the path view (§4.6, §11.10).~~ Done. Export as a reference layer is a natural follow-up.
8. **Later:** curved slots, inverse design, design comparison, optimiser (weighted bob/stride/smoothness), loads.

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
- **Swept area:** exact outer boundary of the foot's sweep (plus the cam's), computed from the envelope condition rather than by sampling poses. If a foot isn't star-shaped about P0, the line falls back to the radial hull, which is never smaller than the true area.

Still open:

1. **Default design:** the app opens with the §9 worked example. Should it be a different weight class or scale?
2. **Left/right phasing:** analysing modules out of sync (roll, steering) is deferred.

## 18. References

- Absolute Chaos Robotics, "Experimentation in Shufflers" (2023): two-cam, pinned-slot single-cam and compliant single-cam designs. https://absolutechaosrobotics.wordpress.com/2023/08/11/experimentation-in-shufflers/
- DigiKey Maker.io, "How to Make a Robot Shuffler Mechanism" (2024). https://www.digikey.com/en/maker/tutorials/2024/how-to-make-a-robot-shuffler-mechanism
- BattleBots Wiki, "Shufflebots". https://battlebots.fandom.com/wiki/Shufflebots
- Robot Wars Wiki, "Walkerbots". https://robotwars.fandom.com/wiki/Walkerbots
- SPARC Robot Construction Specifications v1.6 (shuffler/walker definitions). https://sparc.tools/SPARC_Robot_Construction_Specifications_v1.6.pdf
- NHRL Wiki, "Chonkiii" (shuffler build example). https://wiki.nhrl.io/wiki/index.php/Chonkiii
