import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';
import { makeMarcher, loopsToPath, frameLattice } from '../core/marching';

/**
 * Contour terraces — level sets of a noise field, cut by marching squares.
 *
 * A scalar field v(x, y) ∈ [0, 1] (fractional Brownian value noise, seeded)
 * is sampled on a lattice with pitch CELL (one cell past the frame on every
 * side). For each threshold t_i = i / N the region { v ≥ t_i } is traced as
 * closed polygons by marching squares (`core/marching`). A ring of samples at
 * −1 beyond that guarantees every loop closes; its crossings are clamped to
 * the frame edge, so a region that runs off the sheet is drawn to the edge.
 *
 * Terraces: the regions nest (v ≥ t₂ ⊂ v ≥ t₁), so drawing them lowest first
 * is a painter's stack — every level genuinely covers the one below it, and
 * with fill-rule evenodd the holes (a dip inside a plateau) come out on their
 * own. Fills alternate ink / paper, with every k-th level in accent. Isolines:
 * the same loops as hairline strokes.
 *
 * Motion: the sample point walks a small circle in noise space once per
 * cycle (the same device as `flowfield`): value noise is periodic in nothing,
 * so a closed orbit is the only drift that returns to its own field, and
 * (cos − 1, sin) are exactly 0 at phase 0. `% 1` folds phase 1 onto 0.
 */

const CELL = 4;

export const contour = definePattern({
  id: 'contour',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['noiseScale', 'contrast', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'noiseScale', kind: 'float', min: 0.002, max: 0.02, step: 0.0005, default: 0.006, label: 'contour.noiseScale' },
    { key: 'octaves', kind: 'int', min: 1, max: 5, step: 1, default: 3, label: 'contour.octaves' },
    { key: 'levels', kind: 'int', min: 2, max: 16, step: 1, default: 7, label: 'contour.levels' },
    { key: 'contrast', kind: 'float', min: 0.6, max: 3, step: 0.05, default: 1.6, label: 'contour.contrast' },
    { key: 'mode', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'contour.mode', options: ['contour.terraces', 'contour.isolines'] },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 3, step: 0.05, default: 0.6, label: 'contour.strokeWidth', dependsOn: { key: 'mode', values: [1] } },
    { key: 'accentEvery', kind: 'int', min: 0, max: 8, step: 1, default: 3, label: 'contour.accentEvery' },
  ],
  generate(p, seed, size) {
    const noise = fbm2D(deriveSeed(seed, 'contour'), p['octaves']!);
    const s = p['noiseScale']!;
    const ph = (p['phase'] ?? 0) % 1;
    const R = 0.5;
    const ox = R * (Math.cos(2 * Math.PI * ph) - 1);
    const oy = R * Math.sin(2 * Math.PI * ph);
    const contrast = p['contrast']!;

    const lat = frameLattice(size, CELL, -1, (x, y) => {
      const v = 0.5 + 0.5 * contrast * noise(x * s + ox, y * s + oy);
      return v < 0 ? 0 : v > 1 ? 1 : v;
    });
    const march = makeMarcher(lat);
    const f = (v: number): string => (Math.round(v * 10) / 10).toString();
    const levelPath = (t: number, open: boolean): string => loopsToPath(march(t), open, f);

    const N = p['levels']!;
    const every = p['accentEvery']!;
    const isolines = p['mode'] === 1;
    const children: SvgNode[] = [];
    for (let i = 1; i < N; i++) {
      const d = levelPath(i / N, isolines);
      if (!d) continue;
      const accent = every > 0 && i % every === 0;
      if (isolines) {
        children.push(el('path', {
          d, fill: 'none', stroke: accent ? 'accent' : 'ink',
          'stroke-width': accent ? p['strokeWidth']! * 1.6 : p['strokeWidth']!,
          'stroke-linejoin': 'round',
        }));
      } else {
        const fill = accent ? 'accent' : i % 2 === 1 ? 'ink' : 'paper';
        children.push(el('path', { d, fill, 'fill-rule': 'evenodd', stroke: 'none' }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
