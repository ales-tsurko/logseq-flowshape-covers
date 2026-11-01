import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

export const roselattice = definePattern({
  id: 'roselattice',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['petalDepth', 'innerFraction', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'petals', kind: 'int', min: 3, max: 12, step: 1, default: 5, label: 'roselattice.petals' },
    { key: 'rings', kind: 'int', min: 4, max: 28, step: 1, default: 16, label: 'roselattice.rings' },
    { key: 'spokes', kind: 'int', min: 12, max: 120, step: 1, default: 64, label: 'roselattice.spokes' },
    { key: 'petalDepth', kind: 'float', min: 0, max: 90, step: 1, default: 46, label: 'roselattice.petalDepth' },
    { key: 'innerFraction', kind: 'float', min: 0, max: 0.6, step: 0.01, default: 0.12, label: 'roselattice.innerFraction' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.4, label: 'roselattice.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const petals = p['petals']!;
    const rings = p['rings']!;
    const spokes = p['spokes']!;
    const petalDepth = p['petalDepth']!;
    const innerFraction = p['innerFraction']!;
    const strokeWidth = p['strokeWidth']!;
    const cx = size.w / 2, cy = size.h / 2;
    // Petal precession: the cos(petals * theta) envelope rotates by exactly
    // one symmetry step, 2*PI/petals, per cycle — adding 2*PI inside the
    // cosine. A *rigid* turn of one step would not close, because the spoke
    // set {2*PI*n/spokes} only maps onto itself when spokes is a multiple of
    // petals (64 and 5 by default, so it isn't). Precessing the envelope
    // through a fixed angular lattice closes for every petals/spokes pair.
    const precess = ((p['phase'] ?? 0) % 1) * 2 * Math.PI;

    const outerRadius = 0.44 * Math.min(size.w, size.h);
    const innerRadius = innerFraction * outerRadius;

    // point(m, n): position for ring index m in [0, rings], spoke index n in [0, spokes)
    const point = (m: number, n: number): [number, number] => {
      const t = m / rings;
      const theta = (2 * Math.PI * n) / spokes;
      const base = innerRadius + (outerRadius - innerRadius) * t;
      const r = base + petalDepth * Math.cos(petals * theta - precess) * t;
      const x = cx + r * Math.cos(theta);
      const y = cy + r * Math.sin(theta);
      return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    };

    const children: SvgNode[] = [];

    // Rings: one closed polyline per m, through all spokes.
    for (let m = 0; m <= rings; m++) {
      let d = '';
      for (let n = 0; n < spokes; n++) {
        const [x, y] = point(m, n);
        d += n === 0 ? `M${x} ${y}` : `L${x} ${y}`;
      }
      d += 'Z';
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': strokeWidth }));
    }

    // Spokes: one open polyline per n, through all rings.
    for (let n = 0; n < spokes; n++) {
      let d = '';
      for (let m = 0; m <= rings; m++) {
        const [x, y] = point(m, n);
        d += m === 0 ? `M${x} ${y}` : `L${x} ${y}`;
      }
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': strokeWidth }));
    }

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
