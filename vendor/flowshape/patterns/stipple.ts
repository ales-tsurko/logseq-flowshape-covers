import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

export const stipple = definePattern({
  id: 'stipple',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['minGap', 'maxGap', 'noiseScale', 'contrast', 'dotSize', 'size'] },
  params: [
    { key: 'minGap', kind: 'float', min: 2, max: 8, step: 0.1, default: 2.5, label: 'stipple.minGap' },
    { key: 'maxGap', kind: 'float', min: 8, max: 30, step: 0.5, default: 22, label: 'stipple.maxGap' },
    { key: 'noiseScale', kind: 'float', min: 0.5, max: 4, step: 0.05, default: 1.6, label: 'stipple.noiseScale' },
    { key: 'contrast', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.15, label: 'stipple.contrast' },
    { key: 'dotSize', kind: 'float', min: 0.25, max: 3, step: 0.1, default: 0.7, label: 'stipple.dotSize' },
    { key: 'accentEvery', kind: 'int', min: 0, max: 300, step: 1, default: 173, label: 'stipple.accentEvery' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'stipple'));
    const noise = fbm2D(deriveSeed(seed, 'stipple-density'), 2);
    const m = 20;
    const cx = size.w / 2, cy = size.h / 2;
    const maxDist = Math.hypot(cx - m, cy - m);
    const density = (x: number, y: number): number => {
      const vignette = 1 - Math.hypot(x - cx, y - cy) / maxDist; // 1 center → 0 corner
      const n = (noise((x / size.w) * p['noiseScale']! * 4, (y / size.h) * p['noiseScale']! * 4) + 1) / 2;
      const d = vignette * (1 - p['contrast']!) + vignette * n * 2 * p['contrast']!;
      return Math.max(0, Math.min(1, d));
    };
    const CELL = p['maxGap']!;
    const gw = Math.ceil(size.w / CELL), gh = Math.ceil(size.h / CELL);
    const grid: number[][][] = Array.from({ length: gw * gh }, () => []);
    const placed: [number, number][] = [];
    const children: SvgNode[] = [];
    for (let t = 0; t < 40000; t++) {
      const x = m + rnd() * (size.w - 2 * m);
      const y = m + rnd() * (size.h - 2 * m);
      const d = density(x, y);
      if (d < 0.03) continue;
      const gap = p['minGap']! + (1 - d) * (p['maxGap']! - p['minGap']!);
      const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
      let ok = true;
      const R = Math.ceil(gap / CELL);
      for (let dx = -R; dx <= R && ok; dx++) for (let dy = -R; dy <= R && ok; dy++) {
        const xx = gx + dx, yy = gy + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        for (const pi of grid[xx + yy * gw]!) {
          const q = placed[pi[0]!]!;
          if ((x - q[0]) ** 2 + (y - q[1]) ** 2 < gap * gap) { ok = false; break; }
        }
      }
      if (!ok) continue;
      grid[gx + gy * gw]!.push([placed.length]);
      placed.push([x, y]);
      const accent = p['accentEvery']! > 0 && placed.length % p['accentEvery']! === 0;
      children.push(el('circle', { cx: x, cy: y, r: p['dotSize']!, fill: accent ? 'accent' : 'ink' }));
      if (placed.length >= 8000) break;
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
