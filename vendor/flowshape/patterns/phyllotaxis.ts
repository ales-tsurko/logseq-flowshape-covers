import { el } from '../core/svg';
import { definePattern } from './registry';

const GOLDEN = 137.5078;

export const phyllotaxis = definePattern({
  id: 'phyllotaxis',
  family: 'points',
  phase: 1,
  heavy: false,
  anim: { continuous: ['radialExp', 'dotMin', 'dotGrow', 'size'], usesPhase: true },
  params: [
    { key: 'points', kind: 'int', min: 50, max: 4000, step: 10, default: 1500, label: 'phyllotaxis.points' },
    { key: 'angle', kind: 'float', min: 90, max: 180, step: 0.0001, default: GOLDEN, label: 'phyllotaxis.angle' },
    { key: 'radialExp', kind: 'float', min: 0.35, max: 1, step: 0.01, default: 0.5, label: 'phyllotaxis.radialExp' },
    { key: 'dotMin', kind: 'float', min: 0.15, max: 6, step: 0.1, default: 0.6, label: 'phyllotaxis.dotMin' },
    { key: 'dotGrow', kind: 'float', min: 0, max: 0.01, step: 0.0001, default: 0.003, label: 'phyllotaxis.dotGrow' },
    { key: 'accentEvery', kind: 'int', min: 0, max: 200, step: 1, default: 89, label: 'phyllotaxis.accentEvery' },
  ],
  generate(p, _seed, size) {
    const points = p['points']!;
    const angleRad = (p['angle']! * Math.PI) / 180;
    const exp = p['radialExp']!;
    const cx = size.w / 2;
    const cy = size.h / 2;
    // Fit the outermost point inside the short half-dimension with a 6% margin.
    const maxR = Math.min(size.w, size.h) * 0.47;
    const scale = maxR / Math.pow(points - 1, exp);
    const children = [];
    for (let n = 0; n < points; n++) {
      const r = scale * Math.pow(n, exp);
      const a = n * angleRad + (p['phase'] ?? 0) * 2 * Math.PI;
      const accent = p['accentEvery']! > 0 && n % p['accentEvery']! === 0;
      children.push(
        el('circle', {
          cx: cx + r * Math.cos(a),
          cy: cy + r * Math.sin(a),
          r: p['dotMin']! + n * p['dotGrow']!,
          fill: accent ? 'accent' : 'ink',
        }),
      );
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
