import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Ring lattice, painter's order.
 *
 * Discs of one radius R on a staggered lattice — horizontal pitch 2R·overlap,
 * row pitch R·rowStep, every other row shifted by half a pitch — drawn row by
 * row from the top, so each disc covers the ones above it and only the crown
 * of every earlier disc survives. That is the seigaiha (blue-wave) rule, and
 * the same stacking the Bauhaus textile studies used for overlapping rings.
 *
 * Each disc is one of two fills, chosen by seed: a bold disc (ink, paper
 * rings) or a fine disc (accent, a polar grid of paper rings and spokes).
 * The polar grid needs no clipping: every ring has r ≤ R and every spoke
 * ends at R, so the disc itself is the clip.
 *
 * Motion: ring radii advance outward, r_j = R·((j + ½)/n + phase) mod 1, so
 * each disc pulses as ripples from its centre; `% 1` folds phase 1 onto 0
 * and a full cycle reproduces the phase-0 frame byte for byte.
 */

const r2 = (n: number): number => Math.round(n * 100) / 100;

function ring(cx: number, cy: number, r: number): string {
  const R = r2(r);
  return `M${r2(cx - r)} ${r2(cy)}A${R} ${R} 0 1 0 ${r2(cx + r)} ${r2(cy)}A${R} ${R} 0 1 0 ${r2(cx - r)} ${r2(cy)}`;
}

export const scales = definePattern({
  id: 'scales',
  family: 'tilings',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['ringWidth', 'size'], usesPhase: true },
  params: [
    { key: 'radius', kind: 'int', min: 30, max: 160, step: 2, default: 74, label: 'scales.radius' },
    { key: 'overlap', kind: 'float', min: 0.5, max: 1, step: 0.01, default: 0.72, label: 'scales.overlap' },
    { key: 'rowStep', kind: 'float', min: 0.5, max: 1.6, step: 0.02, default: 0.86, label: 'scales.rowStep' },
    { key: 'rings', kind: 'int', min: 2, max: 8, step: 1, default: 8, label: 'scales.rings' },
    { key: 'boldShare', kind: 'float', min: 0, max: 1, step: 0.05, default: 0.45, label: 'scales.boldShare' },
    { key: 'ringWidth', kind: 'float', min: 0.2, max: 1, step: 0.02, default: 0.66, label: 'scales.ringWidth' },
    { key: 'spokes', kind: 'int', min: 0, max: 32, step: 2, default: 22, label: 'scales.spokes' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'scales'));
    const R = p['radius']!;
    const dx = 2 * R * p['overlap']!;
    const dy = R * p['rowStep']!;
    const n = p['rings']!;
    const ph = (p['phase'] ?? 0) % 1;
    const children: SvgNode[] = [];
    const cols = Math.ceil((size.w + 2 * R) / dx) + 1;
    const rows = Math.ceil((size.h + 2 * R) / dy) + 1;
    for (let row = 0; row < rows; row++) {
      const cy = -R + row * dy;
      const off = row % 2 ? dx / 2 : 0;
      for (let col = 0; col < cols; col++) {
        const cx = -R + off + col * dx;
        if (cx - R > size.w) break;
        const bold = rnd() < p['boldShare']!;
        children.push(el('circle', { cx: r2(cx), cy: r2(cy), r: R, fill: bold ? 'ink' : 'accent', stroke: 'none' }));
        if (bold) {
          let d = '';
          for (let j = 0; j < n; j++) d += ring(cx, cy, R * (((j + 0.5) / n + ph) % 1));
          children.push(el('path', { d, fill: 'none', stroke: 'paper', 'stroke-width': r2((R / n) * p['ringWidth']!) }));
        } else {
          let d = '';
          const fine = 2 * n;
          for (let j = 0; j < fine; j++) d += ring(cx, cy, R * (((j + 0.5) / fine + ph) % 1));
          const spokes = p['spokes']!;
          for (let s = 0; s < spokes; s++) {
            const a = (s / spokes) * Math.PI * 2;
            d += `M${r2(cx)} ${r2(cy)}L${r2(cx + R * Math.cos(a))} ${r2(cy + R * Math.sin(a))}`;
          }
          children.push(el('path', { d, fill: 'none', stroke: 'paper', 'stroke-width': r2(Math.max(0.4, (R / fine) * p['ringWidth']! * 0.3)) }));
        }
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
