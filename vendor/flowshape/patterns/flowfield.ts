import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

export const flowfield = definePattern({
  id: 'flowfield',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['curl', 'freq', 'steps', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'freq', kind: 'float', min: 0.004, max: 0.03, step: 0.001, default: 0.011, label: 'flowfield.freq' },
    { key: 'curl', kind: 'float', min: 0.5, max: 3, step: 0.05, default: 1.9, label: 'flowfield.curl' },
    { key: 'spacing', kind: 'int', min: 6, max: 20, step: 1, default: 9, label: 'flowfield.spacing' },
    { key: 'steps', kind: 'int', min: 50, max: 400, step: 10, default: 300, label: 'flowfield.steps' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 2.5, step: 0.05, default: 0.5, label: 'flowfield.strokeWidth' },
    { key: 'emphasisEvery', kind: 'int', min: 0, max: 40, step: 1, default: 17, label: 'flowfield.emphasisEvery' },
  ],
  generate(p, seed, size) {
    const noise = fbm2D(deriveSeed(seed, 'flow'), 2);
    const rnd = mulberry32(deriveSeed(seed, 'flow-seeds'));
    // Advection: the noise the streamlines are integrated through is itself
    // moving, so the lines are re-solved every frame from a field that has
    // actually travelled — they writhe and stream instead of sitting still.
    // The sample point walks a circle in noise space once per cycle: value
    // noise is periodic in nothing (makeNoise2D hashes absolute cells), so a
    // closed path is the only drift that can return to its own field, and
    // (cos - 1) / sin are exactly 0 at phase 0 so the identity is exact.
    // Radius is deliberately over half a cell here — flowfield wants the
    // large slow reshaping, and nothing downstream is a threshold, so the
    // higher harmonics a wide orbit picks up cost nothing.
    const ph = (p['phase'] ?? 0) % 1;
    const R = 0.6;
    const dx = R * (Math.cos(2 * Math.PI * ph) - 1);
    const dy = R * Math.sin(2 * Math.PI * ph);
    const angle = (x: number, y: number): number =>
      noise(x * p['freq']! + dx, y * p['freq']! + dy) * Math.PI * p['curl']!;
    const m = 20;
    const CELL = 4;
    const gw = Math.ceil(size.w / CELL), gh = Math.ceil(size.h / CELL);
    const occ = new Int16Array(gw * gh);
    let id = 0;
    const children: SvgNode[] = [];
    for (let gy = m; gy < size.h - m; gy += p['spacing']!) {
      for (let gx = m; gx < size.w - m; gx += p['spacing']!) {
        if (rnd() < 0.35) continue;
        id++;
        let x = gx + rnd() * 4, y = gy + rnd() * 4;
        let d = `M${x.toFixed(2)} ${y.toFixed(2)}`;
        let n = 0;
        for (let k = 0; k < p['steps']!; k++) {
          const a = angle(x, y);
          x += Math.cos(a) * 2;
          y += Math.sin(a) * 2;
          if (x < m || x > size.w - m || y < m || y > size.h - m) break;
          const ci = Math.floor(x / CELL) + Math.floor(y / CELL) * gw;
          if (occ[ci] && occ[ci] !== id) break;
          occ[ci] = id;
          d += `L${x.toFixed(2)} ${y.toFixed(2)}`;
          n++;
        }
        if (n < 5) continue;
        const emphasis = p['emphasisEvery']! > 0 && id % p['emphasisEvery']! === 0;
        children.push(el('path', {
          d,
          fill: 'none',
          stroke: 'ink',
          'stroke-width': emphasis ? p['strokeWidth']! * 2.2 : p['strokeWidth']!,
          'stroke-linecap': 'round',
          opacity: emphasis ? 1 : 0.7,
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
