import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

export const diffgrowth = definePattern({
  id: 'diffgrowth',
  family: 'growth',
  phase: 1,
  heavy: true,
  usesSeed: true,
  anim: {},
  params: [
    { key: 'iterations', kind: 'int', min: 50, max: 600, step: 10, default: 500, label: 'diffgrowth.iterations' },
    { key: 'repulsion', kind: 'float', min: 8, max: 26, step: 0.5, default: 18, label: 'diffgrowth.repulsion' },
    { key: 'rings', kind: 'int', min: 0, max: 4, step: 1, default: 2, label: 'diffgrowth.rings' },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 3, step: 0.1, default: 0.7, label: 'diffgrowth.strokeWidth' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'diffgrowth'));
    const R = p['repulsion']!;
    const ITER = p['iterations']!;
    const CAP = 1500;
    const DMAX = 5.5, DMIN = 1.9;
    const m = 26;
    const cx = size.w / 2, cy = size.h / 2;
    let nodes: [number, number][] = [];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * 2 * Math.PI;
      nodes.push([cx + 30 * Math.cos(a), cy + 30 * Math.sin(a)]);
    }
    const paths: string[] = [];
    const snapshot = (): string => {
      let d = `M${nodes[0]![0].toFixed(2)} ${nodes[0]![1].toFixed(2)}`;
      for (let j = 1; j < nodes.length; j++) d += `L${nodes[j]![0].toFixed(2)} ${nodes[j]![1].toFixed(2)}`;
      return d + 'Z';
    };
    const ringAt: number[] = [];
    for (let r = 1; r <= p['rings']!; r++) ringAt.push(Math.floor((ITER * r) / (p['rings']! + 1)));
    for (let k = 1; k <= ITER; k++) {
      const grid = new Map<string, number[]>();
      nodes.forEach(([x, y], i) => {
        const key = `${Math.floor(x / R)},${Math.floor(y / R)}`;
        const cell = grid.get(key);
        if (cell) cell.push(i); else grid.set(key, [i]);
      });
      const moves: [number, number][] = [];
      const len = nodes.length;
      for (let i = 0; i < len; i++) {
        const n = nodes[i]!;
        const prev = nodes[(i - 1 + len) % len]!;
        const next = nodes[(i + 1) % len]!;
        let fx = ((prev[0] + next[0]) / 2 - n[0]) * 0.22;
        let fy = ((prev[1] + next[1]) / 2 - n[1]) * 0.22;
        const gx = Math.floor(n[0] / R), gy = Math.floor(n[1] / R);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${gx + dx},${gy + dy}`);
          if (!cell) continue;
          for (const oi of cell) {
            const di = Math.abs(oi - i);
            if (di < 2 || di > len - 2) continue;
            const ox = n[0] - nodes[oi]![0], oy = n[1] - nodes[oi]![1];
            const dist = Math.hypot(ox, oy);
            if (dist < R && dist > 0.001) {
              const f = ((1 - dist / R) * 0.95) / dist;
              fx += ox * f; fy += oy * f;
            }
          }
        }
        fx += (rnd() - 0.5) * 0.6;
        fy += (rnd() - 0.5) * 0.6;
        moves.push([Math.max(-2, Math.min(2, fx)), Math.max(-2, Math.min(2, fy))]);
      }
      for (let i = 0; i < len; i++) {
        nodes[i]![0] = Math.max(m, Math.min(size.w - m, nodes[i]![0] + moves[i]![0]));
        nodes[i]![1] = Math.max(m, Math.min(size.h - m, nodes[i]![1] + moves[i]![1]));
      }
      if (nodes.length < CAP) {
        const grown: [number, number][] = [];
        let grow = Math.max(1, Math.floor(nodes.length * 0.02));
        for (let i = 0; i < nodes.length; i++) {
          const n1 = nodes[i]!, n2 = nodes[(i + 1) % nodes.length]!;
          grown.push(n1);
          const gap = Math.hypot(n2[0] - n1[0], n2[1] - n1[1]);
          const force = gap > DMAX;
          const opportunistic = grow > 0 && rnd() < 0.03 && gap > DMIN * 1.5;
          if ((force || opportunistic) && grown.length < CAP) {
            if (opportunistic && !force) grow--;
            grown.push([(n1[0] + n2[0]) / 2 + (rnd() - 0.5) * 0.6, (n1[1] + n2[1]) / 2 + (rnd() - 0.5) * 0.6]);
          }
        }
        nodes = grown;
      }
      const merged: [number, number][] = [];
      for (let i = 0; i < nodes.length; i++) {
        const n2 = nodes[(i + 1) % nodes.length]!;
        if (Math.hypot(n2[0] - nodes[i]![0], n2[1] - nodes[i]![1]) > DMIN || merged.length < 8) merged.push(nodes[i]!);
      }
      nodes = merged;
      if (ringAt.includes(k)) paths.push(snapshot());
    }
    paths.push(snapshot());
    const children: SvgNode[] = paths.map((d, i) =>
      el('path', {
        d,
        fill: 'none',
        stroke: 'ink',
        'stroke-width': i === paths.length - 1 ? p['strokeWidth']! : p['strokeWidth']! * 0.7,
        'stroke-linejoin': 'round',
        opacity: i === paths.length - 1 ? 0.95 : 0.18 + 0.14 * i,
      }),
    );
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
