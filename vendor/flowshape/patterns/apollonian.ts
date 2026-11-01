import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

/** Minimal complex-number helpers — no library, just what Descartes' theorem needs. */
export interface Complex { re: number; im: number }

const C0: Complex = { re: 0, im: 0 };
const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cscale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });
const cdiv = (a: Complex, s: number): Complex => cscale(a, 1 / s);
const cconj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
const cabs2 = (a: Complex): number => a.re * a.re + a.im * a.im;

/** Principal complex square root, via polar form. */
function csqrt(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im);
  if (r === 0) return C0;
  const theta = Math.atan2(z.im, z.re);
  const sr = Math.sqrt(r);
  const ht = theta / 2;
  return { re: sr * Math.cos(ht), im: sr * Math.sin(ht) };
}

interface Circle { k: number; z: Complex }

const EPS = 1e-9;

/** Descartes' Circle Theorem, complex form: the two circles tangent to all three of c1,c2,c3. */
function descartesRoots(c1: Circle, c2: Circle, c3: Circle): [Circle, Circle] {
  const kSum = c1.k + c2.k + c3.k;
  const kProdSum = c1.k * c2.k + c2.k * c3.k + c3.k * c1.k;
  const kRad = Math.sqrt(Math.max(0, kProdSum));

  const zWeighted = cadd(cadd(cscale(c1.z, c1.k), cscale(c2.z, c2.k)), cscale(c3.z, c3.k));
  const crossSum = cadd(
    cadd(cscale(cmul(c1.z, c2.z), c1.k * c2.k), cscale(cmul(c2.z, c3.z), c2.k * c3.k)),
    cscale(cmul(c3.z, c1.z), c3.k * c1.k),
  );
  const croot = csqrt(crossSum);

  const kA = kSum + 2 * kRad;
  const kB = kSum - 2 * kRad;
  const zA = Math.abs(kA) > EPS ? cdiv(cadd(zWeighted, cscale(croot, 2)), kA) : C0;
  const zB = Math.abs(kB) > EPS ? cdiv(csub(zWeighted, cscale(croot, 2)), kB) : C0;
  return [{ k: kA, z: zA }, { k: kB, z: zB }];
}

/** From a mutually-tangent triple that (together with `omitted`) forms a known
 *  Descartes quadruple, find the *other* circle tangent to all three. */
function otherTangentCircle(triple: [Circle, Circle, Circle], omitted: Circle): Circle | null {
  const [a, b] = descartesRoots(triple[0], triple[1], triple[2]);
  const dist = (c: Circle): number =>
    Math.abs(c.k - omitted.k) + Math.hypot(c.z.re - omitted.z.re, c.z.im - omitted.z.im);
  const cand = dist(a) < dist(b) ? b : a;
  if (!Number.isFinite(cand.k) || !Number.isFinite(cand.z.re) || !Number.isFinite(cand.z.im)) return null;
  if (Math.abs(cand.k) < EPS) return null;
  return cand;
}

/** A circle in the drawing plane, as centre + radius rather than curvature. */
export interface Disc { z: Complex; r: number }

/**
 * The intrinsic motion is a Möbius flow, because an Apollonian gasket is a
 * Möbius object: `z → (αz + β)/(γz + δ)` maps circles to circles exactly and
 * preserves tangency exactly, so a continuously varying Möbius transformation
 * slides every circle through the packing — growing, shrinking and flowing
 * past its neighbours — while the figure stays a genuine Apollonian gasket at
 * every instant. Nothing here is an approximation of the gasket's own maths;
 * it *is* the gasket's own maths.
 *
 * Which one-parameter subgroup matters a great deal:
 *
 *  - A *hyperbolic* subgroup translates along a geodesic and pumps the whole
 *    configuration off toward one boundary point: unbounded, and it never
 *    returns, so it can be neither framed nor looped.
 *  - A *parabolic* subgroup is bounded but is isomorphic to ℝ, not to the
 *    circle: it has no period, so closing the loop would mean travelling out
 *    and reversing — a breathing, not a flow.
 *  - An *elliptic* subgroup is a rotation in the hyperbolic metric about an
 *    interior fixed point p. It is exactly 2π-periodic, so one cycle of the
 *    engine's phase axis closes it precisely; and every element is a disc
 *    automorphism, so the unit disc — which is the outer circle of the
 *    gasket, the frame itself — maps to itself *exactly* (verified below in
 *    closed form: at c = 0, r = 1 the image is again c = 0, r = 1). The
 *    figure can therefore never leave its frame, at any phase, for any p.
 *
 * So: elliptic, fixing the interior point FLOW_CENTRE. The one thing that
 * would ruin it is p = 0, which degenerates to a Euclidean rotation of the
 * whole figure — rigid, and the weakest motion there is. Off-centre, the same
 * subgroup is emphatically not rigid: p at 0.25 of the disc radius makes some
 * circles grow and shrink by 2.7× over a cycle, and after subtracting the
 * best-fit rigid rotation about the frame centre, 41-52% of the RMS
 * displacement is still there as pure deformation.
 *
 * |p| is a taste parameter with a hard ceiling. As it grows the flow distorts
 * harder, and past about 0.4 the packing degenerates at half-phase into a
 * crescent: one circle swells to fill nearly the whole disc and the gasket
 * reads as an empty ring. Measured largest-inner-circle over a cycle, as a
 * fraction of the outer: 0.5 at rest, 0.735 at |p| = 0.25, 0.775 at 0.3,
 * 0.874 at 0.45 (the crescent). 0.25 keeps a full packing at every phase.
 */
export const FLOW_CENTRE: Complex = { re: 0.25, im: 0 };

/** An element of SU(1,1): the matrix [[a, b], [conj(b), conj(a)]], whose
 *  Möbius action preserves the unit disc. Determinant |a|² − |b|² > 0. */
export interface Mobius { a: Complex; b: Complex }

/**
 * The elliptic element rotating by `theta` about the interior point p —
 * i.e. φ_p ∘ (z → e^{iθ}z) ∘ φ_p⁻¹, where φ_p(z) = (z + p)/(1 + conj(p)z) is
 * the disc automorphism carrying 0 to p. Multiplying that conjugation out
 * gives, with t = θ/2 and s = |p|²:
 *     a = (1 − s)·cos t + i(1 + s)·sin t,     b = −2i·p·sin t
 * which is in SU(1,1) by inspection, with determinant (1 − s)². At t = 0 it
 * is a = 1 − s, b = 0 — the identity map.
 */
export function ellipticAbout(p: Complex, theta: number): Mobius {
  const t = theta / 2;
  const st = Math.sin(t);
  const s = cabs2(p);
  return {
    a: { re: (1 - s) * Math.cos(t), im: (1 + s) * st },
    b: { re: 2 * p.im * st, im: -2 * p.re * st }, // −2i·p·sin t
  };
}

/**
 * The image of the circle (centre `c`, radius `r`) under `M`, in closed form.
 *
 * With f(z) = (αz + β)/(γz + δ) and Δ = αδ − βγ, and writing g = γc + δ:
 *     centre' = ((αc + β)·conj(g) − α·conj(γ)·r²) / (|g|² − |γ|²r²)
 *     radius' = |Δ|·r / | |g|² − |γ|²r² |
 * (Both sides scale as λ² under α,β,γ,δ → λα,λβ,λγ,λδ, so no normalisation
 * of the matrix is needed.) The denominator vanishes only for a circle
 * through the pole z = −δ/γ; every circle here lies in the closed unit disc
 * and the pole of a disc automorphism lies strictly outside it, so that
 * cannot happen — the guard below is belt and braces.
 *
 * Because f is conformal and injective on the sphere, tangency is preserved
 * exactly, not approximately: two circles meeting at one point have images
 * meeting at exactly one point. That is what makes this legal at all, and it
 * is asserted directly in tests/anim/phase-adoption.test.ts.
 */
export function mapDisc(M: Mobius, c: Complex, r: number): Disc | null {
  const al = M.a, be = M.b, ga = cconj(be), de = cconj(al);
  const det = cabs2(al) - cabs2(be); // (1 − |p|²)², real and positive
  const g = cadd(cmul(ga, c), de);
  const denom = cabs2(g) - cabs2(ga) * r * r;
  if (Math.abs(denom) < EPS) return null;
  const num = csub(cmul(cadd(cmul(al, c), be), cconj(g)), cscale(cmul(al, cconj(ga)), r * r));
  const out = { z: cdiv(num, denom), r: Math.abs(det) * r / Math.abs(denom) };
  if (!Number.isFinite(out.z.re) || !Number.isFinite(out.z.im) || !Number.isFinite(out.r)) return null;
  return out;
}

const MAX_CIRCLES = 4000;

export const apollonian = definePattern({
  id: 'apollonian',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['minRadius', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'maxDepth', kind: 'int', min: 2, max: 8, step: 1, default: 6, label: 'apollonian.maxDepth' },
    { key: 'minRadius', kind: 'float', min: 1, max: 30, step: 0.5, default: 3, label: 'apollonian.minRadius' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.5, label: 'apollonian.strokeWidth' },
    { key: 'fillAlternate', kind: 'bool', min: 0, max: 1, step: 1, default: 0, label: 'apollonian.fillAlternate' },
  ],
  generate(p, _seed, size) {
    const maxDepth = p['maxDepth']!;
    const minRadius = p['minRadius']!;
    const strokeWidth = p['strokeWidth']!;
    const fillAlternate = p['fillAlternate']! >= 0.5;

    const R = 0.46 * Math.min(size.w, size.h);
    const cx = size.w / 2, cy = size.h / 2;

    // The flow. `% 1` folds the cyclic axis, so phase 1 is literally the
    // phase-0 expression and the loop closes by construction; and at phase 0
    // the transform is skipped outright rather than evaluated at the
    // identity, which is what makes the resting figure byte-for-byte the one
    // every existing poster URL already renders.
    const ph = (p['phase'] ?? 0) % 1;
    const flow = ph === 0 ? null : ellipticAbout(FLOW_CENTRE, 2 * Math.PI * ph);

    // Seed: an enclosing circle plus two equal inner circles tangent to each
    // other and to the enclosure; the fourth (the "asymmetric" third inner
    // circle from the brief) is generated from that triple via Descartes'
    // theorem itself, rather than derived by hand.
    const outer: Circle = { k: -1, z: C0 };
    const c1: Circle = { k: 2, z: { re: -0.5, im: 0 } };
    const c2: Circle = { k: 2, z: { re: 0.5, im: 0 } };
    const [seedPlus] = descartesRoots(outer, c1, c2);
    const c3: Circle = seedPlus;

    // Centre and radius in the unit-disc coordinates the recursion works in;
    // both are scaled by R at render time.
    interface Emitted { z: Complex; r: number; depth: number }
    const seen = new Set<string>();
    const out: Emitted[] = [];

    // Deduplication stays in the *pre-image* coordinates the Descartes
    // recursion works in, so which circles exist and how they are keyed is
    // independent of phase; only their images move.
    const key = (c: Circle): string =>
      `${Math.round(c.k * 1000)},${Math.round(c.z.re * 1000)},${Math.round(c.z.im * 1000)}`;

    function tryEmit(c: Circle, depth: number): boolean {
      const kk = key(c);
      if (seen.has(kk)) return false;
      const pre = { z: c.z, r: 1 / Math.abs(c.k) };
      const disc = flow ? mapDisc(flow, pre.z, pre.r) : pre;
      if (!disc) return false;
      // The cutoff is tested on the *image* radius, so the visible detail
      // floor is a fixed number of screen pixels at every phase. Culling on
      // the pre-image instead would let the recursion truncate at a floor
      // that the flow then magnifies by up to 2.7×, and the truncation
      // boundary itself would visibly swim around the figure. The price is
      // that circles at the floor bloom in and out as the flow opens and
      // closes room for them: measured over a cycle, every circle either
      // never changes presence or winks out and back exactly once — no cell
      // strobes (see tests/anim/phase-adoption.test.ts).
      if (R * disc.r < minRadius) return false;
      if (out.length >= MAX_CIRCLES) return false;
      seen.add(kk);
      out.push({ z: disc.z, r: disc.r, depth });
      return true;
    }

    for (const c of [outer, c1, c2, c3]) tryEmit(c, 0);

    function recurse(triple: [Circle, Circle, Circle], omitted: Circle, depth: number): void {
      if (depth > maxDepth) return;
      if (out.length >= MAX_CIRCLES) return;
      const next = otherTangentCircle(triple, omitted);
      if (!next) return;
      if (!tryEmit(next, depth)) return;
      const [a, b, c] = triple;
      recurse([a, b, next], c, depth + 1);
      recurse([a, c, next], b, depth + 1);
      recurse([b, c, next], a, depth + 1);
    }

    recurse([outer, c1, c2], c3, 1);
    recurse([outer, c1, c3], c2, 1);
    recurse([outer, c2, c3], c1, 1);
    recurse([c1, c2, c3], outer, 1);

    const children: SvgNode[] = out.map(({ z, r, depth }) => {
      const shade = fillAlternate && depth % 2 === 0;
      return el('circle', {
        cx: cx + R * z.re,
        cy: cy + R * z.im,
        r: R * r,
        fill: shade ? 'ink' : 'none',
        ...(shade ? { 'fill-opacity': 0.12 } : {}),
        stroke: 'ink',
        'stroke-width': strokeWidth,
      });
    });

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
