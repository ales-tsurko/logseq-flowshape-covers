import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Fourier (Lissajous) knots: x(t) = cos(n₁t+φ₁), y(t) = cos(n₂t+φ₂),
 * z(t) = cos(n₃t+φ₃) with (n₁,n₂,n₃) pairwise coprime. The theorem doing
 * mystery's job: integer frequencies force the curve to close after exactly
 * one period, and pairwise coprimality forces it to be a genuine space
 * curve — a common factor would collapse it onto a multiple cover of a
 * shorter curve. The frequencies are fixed as whole coprime triples the
 * user picks from, so the closure cannot be broken by any parameter.
 *
 * The known Lissajous degeneracy — the projection doubling over into a
 * traced-twice arc when nᵢφⱼ − nⱼφᵢ ≡ 0 (mod π) for some pair — is
 * constrained away per seed: phases are resampled until every pair keeps a
 * safe margin from the singular set, so every seed is a genuine knot
 * flourish and none is a scribble.
 *
 * Three exactly 1-periodic motions ride the phase (all fold through `% 1`,
 * integer rates only, so phase 1 is literally the phase-0 expression and
 * every motion vanishes identically at the wrap):
 *  - tumble: the projection azimuth precesses by exactly one whole turn
 *    per cycle — the knot rotates in 3D and returns to its anchor view.
 *  - breathe: the three axis weights swell by sin(2π·k·tw), k = 1,2,3 —
 *    integer rates, zero at the wrap; the knot inflates along different
 *    axes at different beats (an affine deformation, so closure and
 *    knottedness survive every frame).
 *  - fan (mystery's trail): layers spread apart in the phase flow
 *    mid-cycle and close at the wrap.
 *
 * Depth drives the drawing (helix's depthFade precedent): the projected
 * curve is split into depth bands, near strands wider and more opaque,
 * far strands thin and faint — that is what makes the over/under of the
 * knot legible as a made object rather than a flat scribble.
 */

const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [2, 3, 5], [3, 4, 5], [2, 3, 7], [3, 5, 7], [4, 5, 7],
];

/** Depth bands: each band renders as one path element per layer, so the
 *  element count stays O(layers · BANDS) however many samples the curve has. */
const BANDS = 7;

/** Phase margin from the Lissajous singular set: |sin(nᵢφⱼ − nⱼφᵢ)| must
 *  clear this for every pair. 0.2 ≈ 11.5° of arc away from the collapse. */
const DEGEN_MARGIN = 0.2;

/** Fallback phases (checked non-degenerate for every triple in the spike
 *  tests) — only reachable if 48 deterministic draws all land inside the
 *  singular margin, which no seed does in practice. */
const SAFE_PHIS: readonly [number, number, number] = [0.9, 2.2, 4.1];

function pickPhases(rnd: () => number, n: readonly [number, number, number]): [number, number, number] {
  for (let tries = 0; tries < 48; tries++) {
    const phi: [number, number, number] = [rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI];
    let ok = true;
    for (let i = 0; i < 3 && ok; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (Math.abs(Math.sin(n[i]! * phi[j]! - n[j]! * phi[i]!)) < DEGEN_MARGIN) { ok = false; break; }
      }
    }
    if (ok) return phi;
  }
  return [...SAFE_PHIS];
}

export const knot = definePattern({
  id: 'knot',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['tumble', 'breathe', 'depth', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'triple', kind: 'enum', min: 0, max: 4, step: 1, default: 3, label: 'knot.triple', options: ['knot.t235', 'knot.t345', 'knot.t237', 'knot.t357', 'knot.t457'] },
    { key: 'tumble', kind: 'float', min: 0, max: 1.4, step: 0.02, default: 0.46, label: 'knot.tumble' },
    { key: 'breathe', kind: 'float', min: 0, max: 0.6, step: 0.02, default: 0.16, label: 'knot.breathe' },
    { key: 'depth', kind: 'float', min: 0, max: 2, step: 0.05, default: 0.15, label: 'knot.depth' },
    { key: 'layers', kind: 'int', min: 1, max: 5, step: 1, default: 3, label: 'knot.layers' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 1.4, label: 'knot.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.8, label: 'knot.opacity' },
  ],
  generate(p, seed, size) {
    const n = TRIPLES[p['triple']!] ?? TRIPLES[0]!;
    const tilt = p['tumble']!;
    const breathe = p['breathe']!;
    const depth = p['depth']!;
    const layers = p['layers']!;
    const rnd = mulberry32(deriveSeed(seed, 'knot'));
    const phi = pickPhases(rnd, n);
    const ph = (p['phase'] ?? 0) % 1;
    const N = Math.max(768, 128 * Math.max(n[0], n[1], n[2]));
    const cx = size.w / 2, cy = size.h / 2;
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

    // Trail spacing: tight at the anchor frame, fanning open mid-cycle —
    // (1 − cos) is zero at ph = 0, exactly mystery's fan.
    const fan = 0.016 + 0.02 * ((1 - Math.cos(2 * Math.PI * ph)) / 2);

    /** The curve at parameter t viewed at phase-flow time tw: breathe the
     *  axis weights, spin the azimuth by 2π·tw, tip by the fixed tilt. */
    const point = (t: number, tw: number): [number, number, number] => {
      const x = (1 + breathe * Math.sin(2 * Math.PI * tw)) * Math.cos(n[0] * t + phi[0]);
      const y = (1 + breathe * Math.sin(4 * Math.PI * tw)) * Math.cos(n[1] * t + phi[1]);
      const z = (1 + breathe * Math.sin(6 * Math.PI * tw)) * Math.cos(n[2] * t + phi[2]);
      const psi = 2 * Math.PI * tw;
      const cosP = Math.cos(psi), sinP = Math.sin(psi);
      const x1 = x * cosP + z * sinP;
      const z1 = -x * sinP + z * cosP;
      // Tip around the horizontal axis; y goes to the screen, z2 is depth.
      const y2 = y * cosT - z1 * sinT;
      const z2 = y * sinT + z1 * cosT;
      return [x1, y2, z2];
    };

    // Normalize by the extremal projected radius across every layer, so the
    // breathe and the fanned trail never push the figure past the frame;
    // continuous in phase, so the scale breathes rather than jumps.
    let maxR = 0, maxZ = 0;
    const pts: [number, number, number][][] = [];
    for (let L = 0; L < layers; L++) {
      const tw = ph + L * fan;
      const row: [number, number, number][] = [];
      for (let i = 0; i <= N; i++) {
        const q = point((2 * Math.PI * i) / N, tw);
        row.push(q);
        const r = Math.hypot(q[0], q[1]);
        if (r > maxR) maxR = r;
        const az = Math.abs(q[2]);
        if (az > maxZ) maxZ = az;
      }
      pts.push(row);
    }
    const R = (Math.min(size.w, size.h) * 0.44) / (maxR || 1);
    const zNorm = maxZ || 1;

    const children: SvgNode[] = [];
    for (let L = layers - 1; L >= 0; L--) {
      const row = pts[L]!;
      // One path per depth band, each holding every contiguous run of
      // segments whose midpoint falls in that band. Runs share their
      // boundary sample, so the strand stays a visually continuous line.
      const bands: string[] = new Array(BANDS).fill('');
      const lastBand: number[] = new Array(BANDS).fill(-2);
      for (let i = 0; i < N; i++) {
        const a = row[i]!, b = row[i + 1]!;
        const f = ((a[2] + b[2]) / (2 * zNorm) + 1) / 2; // 0 far … 1 near
        let band = Math.floor(f * BANDS);
        if (band >= BANDS) band = BANDS - 1;
        if (band < 0) band = 0;
        const sx = (cx + R * a[0]).toFixed(2), sy = (cy + R * a[1]).toFixed(2);
        const ex = (cx + R * b[0]).toFixed(2), ey = (cy + R * b[1]).toFixed(2);
        bands[band] += lastBand[band] === i - 1 ? `L${ex} ${ey}` : `M${sx} ${sy}L${ex} ${ey}`;
        lastBand[band] = i;
      }
      const layerFade = L === 0 ? 1 : Math.max(0.15, 1 - L / layers);
      for (let b2 = 0; b2 < BANDS; b2++) {
        if (!bands[b2]) continue;
        const f = (b2 + 0.5) / BANDS;
        const w = Math.max(0.12, p['strokeWidth']! * (1 + depth * (f - 0.5)) * (L === 0 ? 1 : 0.8));
        const op = p['opacity']! * (1 - 0.75 * Math.min(1, depth) * (1 - f)) * layerFade;
        children.push(el('path', {
          d: bands[b2]!, fill: 'none', stroke: 'ink',
          'stroke-width': Math.round(w * 100) / 100,
          'stroke-linecap': 'round',
          opacity: Math.round(op * 1000) / 1000,
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
