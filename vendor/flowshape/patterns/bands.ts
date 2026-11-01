import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

interface BBox { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Analytic bounding box of an annular sector spanning angles [a0, a1] (radians,
 * a1 >= a0, a1 - a0 <= 2*PI) with radii [rInner, rOuter]. The extremal point of
 * the sector along an axis direction (0, PI/2, PI, 3*PI/2) is always at rOuter
 * when that axis angle falls inside the sector, since |cos|/|sin| there reaches
 * its global max of 1. Corner points cover the rest.
 */
function annularSectorBBox(a0: number, a1: number, rInner: number, rOuter: number): BBox {
  const pts: [number, number][] = [
    [rOuter * Math.cos(a0), rOuter * Math.sin(a0)],
    [rOuter * Math.cos(a1), rOuter * Math.sin(a1)],
    [rInner * Math.cos(a0), rInner * Math.sin(a0)],
    [rInner * Math.cos(a1), rInner * Math.sin(a1)],
  ];
  const axisAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const axis of axisAngles) {
    // k reaches 4 so the scan still covers sectors whose start angle has
    // been advanced by up to a full extra turn by `phase` (a1 < 6*PI then).
    // For a0 < 2*PI no match ever lands above k = 2, so widening the range
    // leaves every pre-phase render bit-identical.
    for (let k = -1; k <= 4; k++) {
      const a = axis + 2 * Math.PI * k;
      if (a >= a0 && a <= a1) {
        pts.push([rOuter * Math.cos(a), rOuter * Math.sin(a)]);
        break;
      }
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

export const bands = definePattern({
  id: 'bands',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['sweepAngle', 'startAngle', 'growthExponent', 'gap', 'minThickness', 'maxThickness', 'size'], usesPhase: true },
  params: [
    { key: 'bandCount', kind: 'int', min: 3, max: 14, step: 1, default: 7, label: 'bands.bandCount' },
    { key: 'minThickness', kind: 'float', min: 2, max: 40, step: 1, default: 6, label: 'bands.minThickness' },
    { key: 'maxThickness', kind: 'float', min: 10, max: 120, step: 1, default: 54, label: 'bands.maxThickness' },
    { key: 'growthExponent', kind: 'float', min: 0.4, max: 3, step: 0.05, default: 1.6, label: 'bands.growthExponent' },
    { key: 'gap', kind: 'float', min: 0, max: 30, step: 1, default: 8, label: 'bands.gap' },
    { key: 'startAngle', kind: 'float', min: 0, max: 360, step: 1, default: 180, label: 'bands.startAngle' },
    { key: 'sweepAngle', kind: 'float', min: 30, max: 360, step: 1, default: 180, label: 'bands.sweepAngle' },
    { key: 'accentEvery', kind: 'int', min: 0, max: 10, step: 1, default: 0, label: 'bands.accentEvery' },
  ],
  generate(p, _seed, size) {
    const n = p['bandCount']!;
    const minT = p['minThickness']!;
    const maxT = p['maxThickness']!;
    const growth = p['growthExponent']!;
    const gap = p['gap']!;
    const startAngle = p['startAngle']!;
    const sweepAngle = p['sweepAngle']!;
    const accentEvery = p['accentEvery']!;

    // First pass: compute thicknesses and raw (unscaled) radii, starting at 0,
    // in local coordinates centred on the origin.
    const thicknesses: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = minT + (maxT - minT) * (i / Math.max(1, n - 1)) ** growth;
      thicknesses.push(t);
    }
    const r0s: number[] = [];
    const r1s: number[] = [];
    let running = 0;
    for (let i = 0; i < n; i++) {
      const t = thicknesses[i]!;
      r0s.push(running);
      r1s.push(running + t);
      running += t + gap;
    }
    const totalExtent = running - gap; // outer edge of the last band, unscaled

    // Phase turns the fan a full revolution about its own centre. The
    // bounding-box fit below is recomputed from the rotated sector, so the
    // fan stays composed in frame as it turns rather than swinging out of
    // it. `% 1` makes phase 1 add exactly 0, i.e. the identity.
    const rot = ((p['phase'] ?? 0) % 1) * 2 * Math.PI;
    const a0 = (startAngle * Math.PI) / 180 + rot;
    const a1 = a0 + (sweepAngle * Math.PI) / 180;
    const large = sweepAngle > 180 ? 1 : 0;
    // A single elliptical arc from a0 to a1 degenerates when its endpoints
    // coincide: SVG draws nothing at all and the figure vanishes. sweepAngle's
    // max IS 360, so that is reachable from the playground and from any shared
    // URL. It bites slightly before 360 too, because the endpoints are written
    // at two decimals: at sweep 359.9999 they round to the same pair of
    // coordinates and the arc collapses just the same. Anything from FULL_SWEEP
    // up is therefore drawn as two half-turn arcs per edge, which closes the
    // band into a complete annulus instead. The 0.1 deg this rounds away is
    // well under one pixel at any radius the composer can produce.
    const FULL_SWEEP = 359.9;
    const full = sweepAngle >= FULL_SWEEP;
    const aMid = a0 + Math.PI;

    // Compose around the actual bounding box of the drawn sector, not the
    // notional circle centre: the sector spans radii [0, totalExtent] and
    // angles [a0, a1] in these local coordinates.
    const bbox = annularSectorBBox(a0, a1, 0, Math.max(totalExtent, 1e-6));
    const bboxW = bbox.maxX - bbox.minX;
    const bboxH = bbox.maxY - bbox.minY;
    const maxAllowed = 0.92 * Math.min(size.w, size.h);
    const scale = Math.max(bboxW, bboxH) > 0 ? maxAllowed / Math.max(bboxW, bboxH) : 1;
    const bboxCx = (bbox.minX + bbox.maxX) / 2;
    const bboxCy = (bbox.minY + bbox.maxY) / 2;
    // Translate so the scaled bbox centre lands at the frame centre.
    const tx = size.w / 2 - bboxCx * scale;
    const ty = size.h / 2 - bboxCy * scale;

    const pt = (r: number, a: number): string =>
      `${(tx + r * scale * Math.cos(a)).toFixed(2)} ${(ty + r * scale * Math.sin(a)).toFixed(2)}`;

    const children: SvgNode[] = [];
    for (let i = 0; i < n; i++) {
      const r0 = r0s[i]!;
      const r1 = r1s[i]!;
      const r1s2 = r1 * scale, r0s2 = r0 * scale;
      const R1 = r1s2.toFixed(2), R0 = r0s2.toFixed(2);
      // Outer edge runs clockwise, inner edge back anticlockwise, so the
      // non-zero fill rule leaves the hole in the middle. In the full case each
      // edge is two 180 deg arcs; the seam between them is a shared point, not
      // a gap.
      const d = full
        ? `M${pt(r1, a0)}A${R1} ${R1} 0 0 1 ${pt(r1, aMid)}A${R1} ${R1} 0 0 1 ${pt(r1, a0)}` +
          `L${pt(r0, a0)}A${R0} ${R0} 0 0 0 ${pt(r0, aMid)}A${R0} ${R0} 0 0 0 ${pt(r0, a0)}Z`
        : `M${pt(r1, a0)}A${R1} ${R1} 0 ${large} 1 ${pt(r1, a1)}L${pt(r0, a1)}A${R0} ${R0} 0 ${large} 0 ${pt(r0, a0)}Z`;
      const accent = accentEvery > 0 && (i + 1) % accentEvery === 0;
      children.push(el('path', {
        d,
        fill: accent ? 'accent' : 'ink',
        stroke: 'none',
      }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
