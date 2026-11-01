import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

const D2R = Math.PI / 180;

/** Long parallel lines at angle `angleDeg`, spaced `spacing` apart, covering
 *  the whole frame. `shift` slides the whole family along its own normal;
 *  a shift of exactly `spacing` reproduces the same visible grating. */
function gratingLines(
  cx: number,
  cy: number,
  angleDeg: number,
  spacing: number,
  diag: number,
  shift = 0,
): string[] {
  const a = angleDeg * D2R;
  const cos = Math.cos(a), sin = Math.sin(a);
  const paths: string[] = [];
  const half = diag / 2;
  for (let off = -half; off <= half; off += spacing) {
    // Base line runs perpendicular to `a`, offset along `a` by `off`, spanning `-half..half`.
    const bx = cx + (off + shift) * cos, by = cy + (off + shift) * sin;
    const x0 = bx - half * sin, y0 = by + half * cos;
    const x1 = bx + half * sin, y1 = by - half * cos;
    paths.push(`M${x0.toFixed(2)} ${y0.toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`);
  }
  return paths;
}

/** Concentric circles of spacing `spacing` centred at (ox, oy), covering
 *  radius up to `maxR`. `shift` grows every radius outward; a shift of
 *  exactly `spacing` reproduces the same grating with one ring newly born
 *  at the centre — the radial analogue of sliding a line grating, since a
 *  circular grating is periodic in r, not under translation. */
function gratingCircles(ox: number, oy: number, spacing: number, maxR: number, shift = 0): SvgNode[] {
  const out: SvgNode[] = [];
  for (let r = shift; r <= maxR; r += spacing) {
    if (r <= 0) continue; // shift = 0: the r = 0 ring is the one that hasn't been born yet
    out.push(el('circle', { cx: ox.toFixed(2), cy: oy.toFixed(2), r: r.toFixed(2), fill: 'none' }));
  }
  return out;
}

export const moire = definePattern({
  id: 'moire',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['angleA', 'angleB', 'spacingA', 'spacingB', 'offset', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'mode', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'moire.mode', options: ['moire.lines', 'moire.circles'] },
    { key: 'spacingA', kind: 'float', min: 4, max: 40, step: 0.1, default: 9, label: 'moire.spacingA' },
    { key: 'spacingB', kind: 'float', min: 4, max: 40, step: 0.1, default: 9.6, label: 'moire.spacingB' },
    { key: 'angleA', kind: 'float', min: 0, max: 180, step: 1, default: 0, label: 'moire.angleA', dependsOn: { key: 'mode', values: [0] } },
    { key: 'angleB', kind: 'float', min: 0, max: 180, step: 1, default: 6, label: 'moire.angleB', dependsOn: { key: 'mode', values: [0] } },
    { key: 'offset', kind: 'float', min: 0, max: 200, step: 1, default: 60, label: 'moire.offset', dependsOn: { key: 'mode', values: [1] } },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.4, label: 'moire.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const cx = size.w / 2, cy = size.h / 2;
    const sw = p['strokeWidth']!;
    const children: SvgNode[] = [];
    // Grating B drifts over grating A by exactly one period of spacingB per
    // cycle, so the beat pattern returns to itself. `% 1` makes phase 1 the
    // literal identity; the drift is a real translation (lines) or radial
    // advance (circles) of one grating, not a redraw.
    const drift = ((p['phase'] ?? 0) % 1) * p['spacingB']!;

    if (p['mode']! === 0) {
      const diag = Math.hypot(size.w, size.h);
      const a = gratingLines(cx, cy, p['angleA']!, p['spacingA']!, diag);
      const b = gratingLines(cx, cy, p['angleB']!, p['spacingB']!, diag, drift);
      for (const d of a) children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': sw }));
      for (const d of b) children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': sw }));
    } else {
      const maxR = Math.hypot(size.w, size.h) * 0.6;
      const off = p['offset']!;
      const a = gratingCircles(cx - off / 2, cy, p['spacingA']!, maxR);
      const b = gratingCircles(cx + off / 2, cy, p['spacingB']!, maxR, drift);
      for (const c of a) children.push({ ...c, attrs: { ...c.attrs, stroke: 'ink', 'stroke-width': sw } });
      for (const c of b) children.push({ ...c, attrs: { ...c.attrs, stroke: 'ink', 'stroke-width': sw } });
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
