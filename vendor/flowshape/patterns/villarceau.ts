import { el, type SvgNode } from '../core/svg';
import { definePattern, type Params, type Size } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Hopf fibration: the 3-sphere S³ ⊂ ℍ is a disjoint union of great circles
 * (the fibers p·e^{iτ}), one per point of S² under the Hopf map
 * h(p) = p i p̄. Stereographic projection sends every fiber to an exact
 * circle in ℝ³; the fibers over one latitude circle of S² form a torus of
 * mutually linked circles (Villarceau circles), and latitudes nest as tori
 * within tori around the axis through the projection pole's fiber. We draw
 * a chosen band of latitudes, a fixed number of fibers each, as projected
 * polylines → nested, linked, engraved rings.
 *
 * The forced order: motion is the one-parameter SO(4) subgroup of
 * left-isoclinic rotations R(φ): p ↦ q(φ)·p, q(φ) = cos(πφ) + sin(πφ)·n,
 * n a unit pure quaternion. Left multiplication commutes with the right
 * fiber action, so R(φ) carries fibers to fibers and acts on the base S²
 * as the rotation about n by 2πφ. At φ = 1, q = −1 and R(1) = −I: the
 * antipodal map, which is e^{iπ} in every fiber's own circle group — every
 * fiber returns to itself as a set, and with an even sample count the
 * sample sets coincide too. Phase 1 reproduces phase 0 by the group law,
 * not by any construction we impose; `% 1` folding then makes the two
 * frames the same expression byte-for-byte. That is the same class of
 * guarantee as mystery's Farris congruence and knot's integer frequencies.
 *
 * `tilt` sets the angle of n from the polar axis i (the axis of the nested
 * tori). At tilt 0 the rotation is about the axis itself: each torus is
 * carried into itself and the whole figure spins rigidly. Away from 0 the
 * latitude band wobbles across S², so each torus swells, thins and trades
 * places with its neighbours — the tori roll through one another. Near
 * tilt 1 the band sweeps over the pole point h(P) of the projection and
 * the figure turns inside out through infinity.
 *
 * Pole degeneracy, handled in two regimes. A fiber whose base point is at
 * angle δ from the pole point h(P) = i projects to a circle of radius
 * cot(δ/4) core radii; δ = 0 is the fiber through P itself, a straight
 * line. Under R(φ) the pole point traces a circle of angular radius β
 * about n, coming within π − 2β of the core point −i, while the drawn
 * band reaches θ'max from −i. So:
 *  - tilt < 1 − θ'max/π: δ ≥ π − 2β − θ'max > 0 at every phase and the
 *    radius is bounded by cot(δmin/4) — the figure swells and rolls but
 *    cannot explode. This holds at the defaults (threshold ≈ 0.56).
 *  - larger tilt: some fiber passes through the pole mid-cycle. Its samples
 *    are dropped once past CAP resting radii, and any chord longer than
 *    MAX_CHORD is dropped too (two kept samples flanking a dropped run
 *    would otherwise draw a spurious line across the frame). The ring
 *    renders as an arc leaving the frame and re-entering — the Clifford
 *    torus turning inside out through infinity — with every coordinate
 *    bounded by CAP · rExt.
 * With `pole` > 1 the projection point is (pole, 0, 0, 0), outside the
 * sphere: every fiber maps to a bounded conic and the outer rings pull in
 * — that is why `pole` reads as "how far the outer circles fly out".
 *
 * Depth banding follows knot: each latitude's samples are split into
 * depth bands, near arcs wider and more opaque, far arcs thin and faint,
 * so the over/under of the linking reads as an object, not a scribble.
 */

type Q = readonly [number, number, number, number]; // a + b·i + c·j + d·k

function qmul(p: Q, q: Q): Q {
  const [a1, b1, c1, d1] = p, [a2, b2, c2, d2] = q;
  return [
    a1 * a2 - b1 * b2 - c1 * c2 - d1 * d2,
    a1 * b2 + b1 * a2 + c1 * d2 - d1 * c2,
    a1 * c2 - b1 * d2 + c1 * a2 + d1 * b2,
    a1 * d2 + b1 * c2 - c1 * b2 + d1 * a2,
  ];
}

/** Samples per fiber (even, so the −I wrap maps the sample set to itself). */
const N = 96;
/** Depth bands per latitude; element count is O(latitudes · BANDS). */
const BANDS = 6;
/** Projected samples beyond this many core radii are dropped (pole clip). */
const CAP = 12;
/** Chords longer than this many core radii are dropped (pole clip). */
const MAX_CHORD = 1.2;
/** Innermost drawn latitude, colatitude from the core-circle point −i. */
const THETA_LO = 0.32;
/** Seed jitter of a latitude within its slot, as a fraction of the slot. */
const JITTER = 0.4;
/** Largest seed jitter of any latitude, in radians of colatitude. */
export const JITTER_MAX = JITTER * 0.5 * 0.5;

export interface HopfFiber {
  /** Latitude index this fiber belongs to. */
  lat: number;
  /** Projected samples in core-radius units: [x, y, depth], null = clipped. */
  pts: ([number, number, number] | null)[];
}

/**
 * The fibers at the given params/phase, projected to view space (units of
 * the core circle radius, before frame scaling). Exported so the spike
 * tests can measure per-circle motion; `generate` draws from this.
 */
export function hopfFibers(p: Params, seed: number): { fibers: HopfFiber[]; rExt: number } {
  const L = p['latitudes']!;
  const F = p['fibers']!;
  const spread = p['spread']!;
  const nest = p['nest']!;
  const dPole = p['pole']!;
  const tilt = p['tilt']!;
  const ph = (p['phase'] ?? 0) % 1;
  const rnd = mulberry32(deriveSeed(seed, 'villarceau'));

  // Latitude band: colatitudes θ' from the core point −i, evenly spaced
  // across [THETA_LO, THETA_LO + nest]. The seed jitters each latitude
  // within its own slot and turns each sheaf about the axis — the
  // flourish; the nesting order is untouched.
  const step = L > 1 ? nest / (L - 1) : nest;
  const thetas: number[] = [];
  const xiOff: number[] = [];
  for (let l = 0; l < L; l++) {
    const base = L > 1 ? THETA_LO + nest * (l / (L - 1)) : THETA_LO + nest / 2;
    thetas.push(base + (rnd() - 0.5) * JITTER * Math.min(step, 0.5));
    xiOff.push(rnd() * 2 * Math.PI);
  }
  // Rotation axis n at angle β from the polar axis i. Its azimuth ψ is
  // fixed by construction so that the base-sphere fixed point −n (the
  // one near the core, where the ribbons live) sits opposite the innermost
  // ribbon's centre longitude: fibers over a fixed point of the S² rotation
  // would turn within themselves and read as frozen, so the ribbon that
  // comes closest to the axis is kept out of it. ψ inherits the seed
  // through xiOff[0].
  const psi = xiOff[0]! + Math.PI * spread;
  const beta = tilt * Math.PI / 2;
  const n: Q = [0, Math.cos(beta), Math.sin(beta) * Math.cos(psi), Math.sin(beta) * Math.sin(psi)];
  const alpha = Math.PI * ph;
  const q: Q = [Math.cos(alpha), Math.sin(alpha) * n[1], Math.sin(alpha) * n[2], Math.sin(alpha) * n[3]];

  // Resting extent of the outermost torus: a fiber sample at real part a
  // projects to radius √(1 − a²)/(pole − a); the torus at θ' has |a| ≤
  // sin(θ'/2). Maximised on a short grid so pole > 1 (interior maximum)
  // is handled too.
  const aMax = Math.sin(Math.max(...thetas) / 2);
  let rExt = 0;
  for (let i = 0; i <= 32; i++) {
    const a = -aMax + (2 * aMax * i) / 32;
    rExt = Math.max(rExt, Math.sqrt(Math.max(0, 1 - a * a)) / (dPole - a));
  }

  // View elevation: 0 looks straight down the torus axis, π/2 side-on.
  const elev = p['view']!;
  const cosE = Math.cos(elev), sinE = Math.sin(elev);
  const fibers: HopfFiber[] = [];
  for (let l = 0; l < L; l++) {
    // θ = π − θ' is the colatitude from i; p₀ rotates i to the base point.
    const half = (Math.PI - thetas[l]!) / 2;
    const c0 = Math.cos(half), s0 = Math.sin(half);
    // Each latitude carries a sheaf of F fibers over a longitude arc of
    // `spread` turns: a twisted ribbon lying on its torus (spread 1 is the
    // whole torus, every fiber a Villarceau circle of it).
    for (let f = 0; f < F; f++) {
      const xi = xiOff[l]! + (2 * Math.PI * spread * f) / F;
      const p0: Q = [c0, 0, -s0 * Math.sin(xi), s0 * Math.cos(xi)];
      const qp = qmul(q, p0);
      const pts: ([number, number, number] | null)[] = [];
      for (let k = 0; k < N; k++) {
        const tau = (2 * Math.PI * k) / N;
        const [a, b, c, d] = qmul(qp, [Math.cos(tau), Math.sin(tau), 0, 0]);
        const den = dPole - a;
        if (den < 1e-9) { pts.push(null); continue; }
        // ℝ³ point (u, v, w): u along the torus axis.
        const u = b / den, v = c / den, w = d / den;
        const x = v;
        const y = w * cosE + u * sinE;
        const z = -w * sinE + u * cosE;
        if (Math.hypot(x, y) > CAP * rExt) { pts.push(null); continue; }
        pts.push([x, y, z]);
      }
      fibers.push({ lat: l, pts });
    }
  }
  return { fibers, rExt };
}

export const villarceau = definePattern({
  id: 'villarceau',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['spread', 'nest', 'pole', 'tilt', 'view', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'latitudes', kind: 'int', min: 1, max: 7, step: 1, default: 3, label: 'villarceau.latitudes' },
    { key: 'fibers', kind: 'int', min: 3, max: 48, step: 1, default: 28, label: 'villarceau.fibers' },
    { key: 'spread', kind: 'float', min: 0.05, max: 1, step: 0.01, default: 0.3, label: 'villarceau.spread' },
    { key: 'nest', kind: 'float', min: 0.2, max: 1.8, step: 0.02, default: 1.0, label: 'villarceau.nest' },
    { key: 'pole', kind: 'float', min: 1, max: 1.6, step: 0.01, default: 1, label: 'villarceau.pole' },
    { key: 'tilt', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.25, label: 'villarceau.tilt' },
    { key: 'view', kind: 'float', min: 0, max: 1.5, step: 0.01, default: 0.6, label: 'villarceau.view' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 1, label: 'villarceau.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.85, label: 'villarceau.opacity' },
  ],
  generate(p, seed, size: Size) {
    const { fibers, rExt } = hopfFibers(p, seed);
    const L = p['latitudes']!;
    const cx = size.w / 2, cy = size.h / 2;
    const K = (Math.min(size.w, size.h) * 0.42) / rExt;
    const maxChord = MAX_CHORD * rExt;

    // One path per (latitude, depth band), each holding every contiguous
    // run of segments whose midpoint falls in that band (knot's scheme).
    const bands: string[][] = [];
    const last: number[][] = [];
    for (let l = 0; l < L; l++) { bands.push(new Array(BANDS).fill('')); last.push(new Array(BANDS).fill(-2)); }

    let key = 0;
    for (const fb of fibers) {
      const pts = fb.pts;
      for (let k = 0; k < N; k++) {
        const a = pts[k], b = pts[(k + 1) % N];
        key++;
        if (!a || !b) continue;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > maxChord) continue;
        const fz = ((a[2] + b[2]) / (2 * rExt) + 1) / 2; // 0 far … 1 near
        let band = Math.floor(fz * BANDS);
        if (band >= BANDS) band = BANDS - 1;
        if (band < 0) band = 0;
        const sx = (cx + K * a[0]).toFixed(2), sy = (cy + K * a[1]).toFixed(2);
        const ex = (cx + K * b[0]).toFixed(2), ey = (cy + K * b[1]).toFixed(2);
        const row = bands[fb.lat]!, lrow = last[fb.lat]!;
        row[band] += lrow[band] === key - 1 ? `L${ex} ${ey}` : `M${sx} ${sy}L${ex} ${ey}`;
        lrow[band] = key;
      }
      key++; // fibers never join across the seam
    }

    const children: SvgNode[] = [];
    for (let b2 = 0; b2 < BANDS; b2++) {
      const f = (b2 + 0.5) / BANDS;
      const w = Math.max(0.12, p['strokeWidth']! * (0.4 + 1.2 * f));
      const op = p['opacity']! * (0.14 + 0.86 * f);
      for (let l = 0; l < L; l++) {
        const d = bands[l]![b2]!;
        if (!d) continue;
        children.push(el('path', {
          d, fill: 'none', stroke: 'ink',
          'stroke-width': Math.round(w * 100) / 100,
          'stroke-linecap': 'round',
          opacity: Math.round(op * 1000) / 1000,
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
