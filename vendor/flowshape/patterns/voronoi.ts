import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { voronoiCell, centroid, type Pt } from '../core/geometry';

export const voronoiCells = definePattern({
  id: 'voronoi',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['inset', 'strokeWidth', 'size'] },
  params: [
    { key: 'sites', kind: 'int', min: 30, max: 300, step: 5, default: 150, label: 'voronoi.sites' },
    { key: 'inset', kind: 'float', min: 0.5, max: 0.98, step: 0.01, default: 0.86, label: 'voronoi.inset' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 3, step: 0.1, default: 0.5, label: 'voronoi.strokeWidth' },
    { key: 'inkEvery', kind: 'int', min: 0, max: 40, step: 1, default: 13, label: 'voronoi.inkEvery' },
    { key: 'accentEvery', kind: 'int', min: 0, max: 40, step: 1, default: 19, label: 'voronoi.accentEvery' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'voronoi'));
    const m = 8;
    const sites: Pt[] = [];
    for (let i = 0; i < p['sites']!; i++) {
      sites.push([m + rnd() * (size.w - 2 * m), m + rnd() * (size.h - 2 * m)]);
    }
    const bounds: Pt[] = [[4, 4], [size.w - 4, 4], [size.w - 4, size.h - 4], [4, size.h - 4]];
    const children: SvgNode[] = [];
    const f2 = (n: number) => Math.round(n * 100) / 100;
    for (let i = 0; i < sites.length; i++) {
      const poly = voronoiCell(sites, i, bounds);
      if (poly.length < 3) continue;
      const c = centroid(poly);
      const inset = poly.map(([x, y]) => [
        c[0] + (x - c[0]) * p['inset']!,
        c[1] + (y - c[1]) * p['inset']!,
      ] as Pt);
      let fill = 'paper';
      if (p['accentEvery']! > 0 && i % p['accentEvery']! === 0) fill = 'accent';
      else if (p['inkEvery']! > 0 && i % p['inkEvery']! === 0) fill = 'ink';
      children.push(el('polygon', {
        points: inset.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' '),
        fill,
        stroke: 'ink',
        'stroke-width': p['strokeWidth']!,
      }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
