import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

interface Charge {
  x: number;
  y: number;
  q: number;
}

export const coulomb = definePattern({
  id: 'coulomb',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['coreRadius', 'steps', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'charges', kind: 'int', min: 2, max: 8, step: 1, default: 4, label: 'coulomb.charges' },
    { key: 'spacing', kind: 'int', min: 6, max: 24, step: 1, default: 10, label: 'coulomb.spacing' },
    { key: 'steps', kind: 'int', min: 50, max: 400, step: 10, default: 300, label: 'coulomb.steps' },
    { key: 'coreRadius', kind: 'float', min: 4, max: 40, step: 1, default: 12, label: 'coulomb.coreRadius' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 2, step: 0.05, default: 0.5, label: 'coulomb.strokeWidth' },
    { key: 'emphasisEvery', kind: 'int', min: 0, max: 40, step: 1, default: 0, label: 'coulomb.emphasisEvery' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'coulomb'));
    const n = p['charges']!;
    const cx = size.w / 2, cy = size.h / 2;
    const R = 0.3 * Math.min(size.w, size.h);
    const core = p['coreRadius']!;
    const core2 = core * core;
    const stopDist = core * 1.5;
    // The charges orbit their ring centre once per cycle; the field — and
    // so every streamline — is re-solved from the moved sources, which is
    // the whole point: the lines writhe because the field really moved.
    // Added to the angle only, so each charge stays on the ring of radius R
    // and the jitter draw order (and therefore the seed) is untouched.
    const orbit = ((p['phase'] ?? 0) % 1) * 2 * Math.PI;

    const charges: Charge[] = [];
    for (let i = 0; i < n; i++) {
      const baseAngle = (i / n) * Math.PI * 2;
      const jitter = (rnd() - 0.5) * (Math.PI * 2 / n) * 0.6;
      const a = baseAngle + jitter + orbit;
      const sign = i % 2 === 0 ? 1 : -1;
      charges.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), q: sign });
    }

    const field = (x: number, y: number): [number, number] => {
      let ex = 0, ey = 0;
      for (const c of charges) {
        const dx = x - c.x, dy = y - c.y;
        const d2 = Math.max(dx * dx + dy * dy, core2);
        ex += (c.q * dx) / d2;
        ey += (c.q * dy) / d2;
      }
      const mag = Math.sqrt(ex * ex + ey * ey) || 1;
      return [ex / mag, ey / mag];
    };

    const nearCharge = (x: number, y: number): boolean => {
      for (const c of charges) {
        const dx = x - c.x, dy = y - c.y;
        if (dx * dx + dy * dy < stopDist * stopDist) return true;
      }
      return false;
    };

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
        let cnt = 0;
        for (let k = 0; k < p['steps']!; k++) {
          const [dx, dy] = field(x, y);
          x += dx * 2;
          y += dy * 2;
          if (x < m || x > size.w - m || y < m || y > size.h - m) break;
          if (nearCharge(x, y)) break;
          const ci = Math.floor(x / CELL) + Math.floor(y / CELL) * gw;
          if (occ[ci] && occ[ci] !== id) break;
          occ[ci] = id;
          d += `L${x.toFixed(2)} ${y.toFixed(2)}`;
          cnt++;
        }
        if (cnt < 5) continue;
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
