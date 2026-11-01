import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { delaunay, type Pt } from '../core/geometry';

export const delaunayMesh = definePattern({
  id: 'delaunay',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['points', 'vertexSize', 'strokeWidth', 'size'] },
  params: [
    { key: 'points', kind: 'int', min: 40, max: 500, step: 5, default: 220, label: 'delaunay.points' },
    { key: 'mode', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'delaunay.mode', options: ['delaunay.edges', 'delaunay.mosaic'] },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 3, step: 0.1, default: 0.4, label: 'delaunay.strokeWidth' },
    { key: 'vertexSize', kind: 'float', min: 0, max: 4, step: 0.1, default: 1.6, label: 'delaunay.vertexSize', dependsOn: { key: 'mode', values: [0] } },
    { key: 'accentEvery', kind: 'int', min: 0, max: 60, step: 1, default: 23, label: 'delaunay.accentEvery', dependsOn: { key: 'mode', values: [1] } },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'delaunay'));
    const m = 18;
    const pts: Pt[] = [];
    for (let i = 0; i < p['points']!; i++) {
      pts.push([m + rnd() * (size.w - 2 * m), m + rnd() * (size.h - 2 * m)]);
    }
    const tris = delaunay(pts);
    const children: SvgNode[] = [];
    const f2 = (n: number) => Math.round(n * 100) / 100;
    if (p['mode']! === 1) {
      tris.forEach((t, i) => {
        const fill = p['accentEvery']! > 0 && i % p['accentEvery']! === 0
          ? (i % (p['accentEvery']! * 2) === 0 ? 'accent' : 'ink')
          : 'paper';
        children.push(el('polygon', {
          points: t.map((idx) => `${f2(pts[idx]![0])},${f2(pts[idx]![1])}`).join(' '),
          fill,
          stroke: 'ink',
          'stroke-width': p['strokeWidth']!,
        }));
      });
    } else {
      let d = '';
      for (const t of tris) {
        const [a, b, c] = [pts[t[0]]!, pts[t[1]]!, pts[t[2]]!];
        d += `M${f2(a[0])} ${f2(a[1])}L${f2(b[0])} ${f2(b[1])}L${f2(c[0])} ${f2(c[1])}Z`;
      }
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']! }));
      if (p['vertexSize']! > 0) {
        for (const [x, y] of pts) children.push(el('circle', { cx: x, cy: y, r: p['vertexSize']!, fill: 'ink' }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
