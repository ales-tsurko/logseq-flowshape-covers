import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

const MARGIN = 40;
const SAMPLES_PER_TURN = 24;

interface Sample { x: number; y: number; z: number }

export const helix = definePattern({
  id: 'helix',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['turns', 'radiusFraction', 'depthFade', 'strokeWidth'], usesPhase: true },
  params: [
    { key: 'turns', kind: 'float', min: 2, max: 12, step: 0.1, default: 6, label: 'helix.turns' },
    { key: 'radiusFraction', kind: 'float', min: 0.08, max: 0.4, step: 0.01, default: 0.22, label: 'helix.radiusFraction' },
    { key: 'rungEvery', kind: 'int', min: 1, max: 12, step: 1, default: 3, label: 'helix.rungEvery' },
    { key: 'depthFade', kind: 'float', min: 0, max: 2, step: 0.05, default: 1.1, label: 'helix.depthFade' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.5, label: 'helix.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const turns = p['turns']!;
    const radiusFraction = p['radiusFraction']!;
    const rungEvery = p['rungEvery']!;
    const depthFade = p['depthFade']!;
    const strokeWidth = p['strokeWidth']!;
    const spin = (p['phase'] ?? 0) * 2 * Math.PI;

    const cx = size.w / 2;
    const radius = radiusFraction * Math.min(size.w, size.h);
    const usableHeight = size.h - 2 * MARGIN;
    const yTop = MARGIN;
    const tMax = turns * 2 * Math.PI;
    const N = Math.max(2, Math.round(turns * SAMPLES_PER_TURN));

    const sample = (phase: number, k: number): Sample => {
      const t = (k / N) * tMax;
      return {
        x: cx + radius * Math.cos(t + phase),
        y: yTop + (t / tMax) * usableHeight,
        z: Math.sin(t + phase),
      };
    };

    const r2 = (v: number): number => Math.round(v * 100) / 100;

    // Rungs drawn first so the strands render on top of them.
    const children: SvgNode[] = [];
    for (let k = 0; k <= N; k += rungEvery) {
      const a = sample(spin, k);
      const b = sample(Math.PI + spin, k);
      const d = `M${r2(a.x)} ${r2(a.y)}L${r2(b.x)} ${r2(b.y)}`;
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': r2(strokeWidth * 0.7) }));
    }

    // Two strands, each split into short segments so stroke width can fake depth.
    for (const phase of [spin, Math.PI + spin]) {
      let prev = sample(phase, 0);
      for (let k = 1; k <= N; k++) {
        const cur = sample(phase, k);
        const zAvg = (prev.z + cur.z) / 2;
        const w = strokeWidth * (1 + (depthFade * (zAvg + 1)) / 2);
        const d = `M${r2(prev.x)} ${r2(prev.y)}L${r2(cur.x)} ${r2(cur.y)}`;
        children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': r2(w), 'stroke-linecap': 'round' }));
        prev = cur;
      }
    }

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
