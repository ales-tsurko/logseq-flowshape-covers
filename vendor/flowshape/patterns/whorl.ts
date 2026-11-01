import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { makeMarcher, loopsToPath, frameLattice } from '../core/marching';

/**
 * Whorl bands — a stripe field bent by pull and push centres.
 *
 * Start with a surface that is a plain ramp across the sheet, rising by one
 * unit per stripe, then add a Gaussian hill at every pull centre and a
 * Gaussian pit at every push centre:
 *
 *   f(p) = count · ⟨p − o, n⟩ / H  +  Σᵢ sᵢ · Aᵢ · exp(−|p − cᵢ|² / 2σᵢ²)
 *
 * The bands are the parity of ⌊f⌋: the region between consecutive integer
 * level sets. Far from every centre the level sets are the parallel stripes
 * of the ramp; near a strong centre the hill dominates and they close into
 * concentric rings around it, and in between they bend around the hill the
 * way contour lines bend around a summit. It is a contour map of an
 * invented landscape, drawn as alternating bands instead of lines.
 *
 * Drawing: every integer level set is traced by marching squares
 * (`core/marching`) and all of them go into ONE path with fill-rule evenodd.
 * The regions { f ≥ k } nest, so a point lying inside m of the loops has
 * ⌊f⌋ = m and is filled exactly when m is odd — the parity comes out of the
 * fill rule, with no per-band bookkeeping. Lines mode strokes the same loops.
 *
 * Motion: the thresholds slide, t_k = k − 2·phase, so the whole band field
 * flows across the surface once per period of two stripes; at phase 1 the
 * thresholds are integers again and the frame is byte-identical to phase 0.
 */

const CELL = 4;

export const whorl = definePattern({
  id: 'whorl',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['pull', 'push', 'reach', 'angle', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'count', kind: 'int', min: 4, max: 80, step: 1, default: 24, label: 'whorl.count' },
    { key: 'centres', kind: 'int', min: 1, max: 6, step: 1, default: 3, label: 'whorl.centres' },
    { key: 'pull', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.6, label: 'whorl.pull' },
    { key: 'push', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.35, label: 'whorl.push' },
    { key: 'reach', kind: 'float', min: 0.1, max: 0.6, step: 0.01, default: 0.3, label: 'whorl.reach' },
    { key: 'angle', kind: 'float', min: 0, max: 180, step: 1, default: 0, label: 'whorl.angle' },
    { key: 'render', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'whorl.render', options: ['whorl.bands', 'whorl.lines'] },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 3, step: 0.05, default: 0.6, label: 'whorl.strokeWidth', dependsOn: { key: 'render', values: [1] } },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'whorl'));
    const D = Math.min(size.w, size.h);
    const count = p['count']!;
    const a = (p['angle']! / 180) * Math.PI;
    // Stripe normal: at angle 0 the stripes are horizontal, so f grows with y.
    const nx = -Math.sin(a), ny = Math.cos(a);
    const ox = size.w / 2, oy = size.h / 2;

    // Centres: seeded positions in the inner 80% of the sheet, alternating
    // pull (hill) and push (pit) starting with a pull; σ jittered per centre.
    const n = p['centres']!;
    const cs: { x: number; y: number; A: number; s2: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = size.w * (0.1 + 0.8 * rnd()), y = size.h * (0.1 + 0.8 * rnd());
      const sigma = p['reach']! * D * (0.75 + 0.5 * rnd());
      const strength = i % 2 === 0 ? p['pull']! : -p['push']!;
      cs.push({ x, y, A: strength * count, s2: 2 * sigma * sigma });
    }
    const field = (x: number, y: number): number => {
      let f = (count * ((x - ox) * nx + (y - oy) * ny)) / size.h + count / 2;
      for (const c of cs) {
        const dx = x - c.x, dy = y - c.y;
        f += c.A * Math.exp(-(dx * dx + dy * dy) / c.s2);
      }
      return f;
    };

    // The pad sits far below any threshold; with the field in stripe units
    // (tens), −1e6 is unreachable by any centre.
    const lat = frameLattice(size, CELL, -1e6, field);
    const { lo, hi } = lat;
    const march = makeMarcher(lat);
    const f = (v: number): string => (Math.round(v * 10) / 10).toString();

    const ph = (p['phase'] ?? 0) % 1;
    const lines = p['render'] === 1;
    let d = '';
    // Thresholds k − 2·phase for every integer k that can cross the field.
    // Two levels per cycle, not one: one stripe period is two bands, so the
    // parity — which band is ink — returns with the geometry.
    for (let k = Math.ceil(lo) - 2; k <= Math.floor(hi) + 2; k++) {
      const t = k - 2 * ph;
      if (t <= lo || t >= hi) continue;
      d += loopsToPath(march(t), lines, f);
    }
    const children: SvgNode[] = [];
    if (d) {
      children.push(lines
        ? el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, 'stroke-linejoin': 'round' })
        : el('path', { d, fill: 'ink', 'fill-rule': 'evenodd', stroke: 'none' }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
