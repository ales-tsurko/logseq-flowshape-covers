import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

/**
 * A loxodromic Möbius transformation has two fixed points: every orbit
 * spirals out of one and into the other. Conjugating multiplication by
 * λ = shrink·e^{i·twist} through T(z) = (z−p)/(z−q) gives the map, and
 * because Möbius transformations send circles to circles *exactly*, each
 * seed circle's whole orbit can be computed in closed form — no sampling,
 * no approximation. Fractional powers λ^u make the discrete orbit a
 * continuous flow, which is what the phase animation rides.
 */

interface Circle { x: number; y: number; r: number }

/** Image of a circle under f(z) = (az+b)/(cz+d), all coefficients complex
 *  as [re, im]. Returns null when the circle passes through the pole (its
 *  image is a line, which this pattern simply does not draw). */
function mobiusCircle(
  a: [number, number], b: [number, number], c: [number, number], d: [number, number],
  circ: Circle,
): Circle | null {
  // W = c·γ + d — the circle recentred by the denominator's affine part.
  const wx = c[0] * circ.x - c[1] * circ.y + d[0];
  const wy = c[0] * circ.y + c[1] * circ.x + d[1];
  const R1 = Math.hypot(c[0], c[1]) * circ.r;
  const den = wx * wx + wy * wy - R1 * R1;
  if (Math.abs(den) < 1e-9 * (wx * wx + wy * wy + R1 * R1 + 1e-12)) return null;
  // Inversion w → 1/w maps circle (W, R1) to (conj(W)/den, R1/|den|).
  const ix = wx / den, iy = -wy / den, ir = R1 / Math.abs(den);
  // K = (bc − ad)/c, so that f(z) = a/c + K/(cz+d).
  const cc = c[0] * c[0] + c[1] * c[1];
  const bcx = b[0] * c[0] - b[1] * c[1], bcy = b[0] * c[1] + b[1] * c[0];
  const adx = a[0] * d[0] - a[1] * d[1], ady = a[0] * d[1] + a[1] * d[0];
  const nx = bcx - adx, ny = bcy - ady;
  const kx = (nx * c[0] + ny * c[1]) / cc, ky = (ny * c[0] - nx * c[1]) / cc;
  const ox = (a[0] * c[0] + a[1] * c[1]) / cc, oy = (a[1] * c[0] - a[0] * c[1]) / cc;
  return {
    x: ox + kx * ix - ky * iy,
    y: oy + kx * iy + ky * ix,
    r: Math.hypot(kx, ky) * ir,
  };
}

export const loxodrome = definePattern({
  id: 'loxodrome',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['twist', 'shrink', 'seedRadius', 'spread', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'seeds', kind: 'int', min: 1, max: 8, step: 1, default: 4, label: 'loxodrome.seeds' },
    { key: 'steps', kind: 'int', min: 10, max: 60, step: 1, default: 34, label: 'loxodrome.steps' },
    { key: 'twist', kind: 'float', min: -60, max: 60, step: 0.5, default: 18, label: 'loxodrome.twist' },
    { key: 'shrink', kind: 'float', min: 0.82, max: 0.98, step: 0.005, default: 0.9, label: 'loxodrome.shrink' },
    { key: 'seedRadius', kind: 'float', min: 0.05, max: 0.5, step: 0.01, default: 0.22, label: 'loxodrome.seedRadius' },
    { key: 'spread', kind: 'float', min: 0.2, max: 1.2, step: 0.01, default: 0.75, label: 'loxodrome.spread' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.5, label: 'loxodrome.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.9, label: 'loxodrome.opacity' },
  ],
  generate(p, _seed, size) {
    const cx = size.w / 2, cy = size.h / 2;
    const D = Math.min(size.w, size.h) * 0.27;
    // Fixed points of the flow, symmetric about the frame centre.
    const P: [number, number] = [cx - D, cy];
    const Q: [number, number] = [cx + D, cy];
    const theta = p['twist']! * (Math.PI / 180);
    const s = p['shrink']!;
    const K = p['steps']!;
    const seeds = p['seeds']!;
    const ph = (p['phase'] ?? 0) % 1;
    const children: SvgNode[] = [];
    const maxR = Math.hypot(size.w, size.h) * 1.5;
    for (let j = 0; j < seeds; j++) {
      const psi = (2 * Math.PI * j) / seeds + Math.PI / (2 * seeds);
      const seed: Circle = {
        x: cx + p['spread']! * D * Math.cos(psi),
        y: cy + p['spread']! * D * Math.sin(psi),
        r: p['seedRadius']! * D,
      };
      for (let k = -K; k <= K; k++) {
        // The flow coordinate. Phase slides every circle one step along its
        // own orbit per cycle; at phase 1 the index set {k+1} wraps back to
        // {k}, so the drawn family maps exactly onto itself — the loop
        // closes because the configuration is invariant under the map that
        // is animating it.
        let u = k + ph;
        if (u > K) u -= 2 * K + 1;
        // T(z) = (z−p)/(z−q): a = 1, b = −p, c = 1, d = −q.
        const w = mobiusCircle([1, 0], [-P[0], -P[1]], [1, 0], [-Q[0], -Q[1]], seed);
        if (!w) continue;
        // λ^u — scaling a circle by a complex number is exact too.
        const mag = Math.pow(s, u);
        const ang = theta * u;
        const lx = mag * Math.cos(ang), ly = mag * Math.sin(ang);
        const scaled: Circle = {
          x: lx * w.x - ly * w.y,
          y: lx * w.y + ly * w.x,
          r: mag * w.r,
        };
        // T⁻¹(w) = (−q·w + p)/(−w + 1).
        const img = mobiusCircle([-Q[0], -Q[1]], [P[0], P[1]], [-1, 0], [1, 0], scaled);
        if (!img || !Number.isFinite(img.r) || img.r > maxR || img.r < 0.05) continue;
        // sin² ramp: zero at u = −K and u = K+1, the two ends where circles
        // are born and die during the phase cycle — no pop at the seam.
        const fade = Math.sin((Math.PI * (u + K)) / (2 * K + 1)) ** 2;
        const op = p['opacity']! * fade;
        if (op < 0.01) continue;
        children.push(el('circle', {
          cx: img.x, cy: img.y, r: img.r,
          fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, opacity: Math.round(op * 1000) / 1000,
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
