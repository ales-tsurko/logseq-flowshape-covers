import { el } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

const RATIOS: [number, number][] = [[2, 3], [3, 4], [1, 2], [3, 5]];

export const harmonograph = definePattern({
  id: 'harmonograph',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['detune', 'damping', 'duration', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'ratio', kind: 'enum', min: 0, max: 3, step: 1, default: 0, label: 'harmonograph.ratio', options: ['harmonograph.r23', 'harmonograph.r34', 'harmonograph.r12', 'harmonograph.r35'] },
    { key: 'detune', kind: 'float', min: 0, max: 0.02, step: 0.0005, default: 0.007, label: 'harmonograph.detune' },
    { key: 'damping', kind: 'float', min: 0.001, max: 0.02, step: 0.0005, default: 0.0045, label: 'harmonograph.damping' },
    { key: 'duration', kind: 'int', min: 100, max: 600, step: 10, default: 480, label: 'harmonograph.duration' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.3, label: 'harmonograph.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.32, label: 'harmonograph.opacity' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'harmonograph'));
    const [fa, fb] = RATIOS[p['ratio']!]!;
    const ph = [rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI] as const;
    const off = (p['phase'] ?? 0) * 2 * Math.PI;
    const d1 = p['damping']!, d2 = d1 * 0.75;
    const det = p['detune']!;
    const cx = size.w / 2, cy = size.h / 2;
    const A = Math.min(size.w, size.h) * 0.22;
    const dt = 0.02;
    const steps = Math.floor(p['duration']! / dt);
    let d = '';
    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      const x = cx + A * (1.2 * Math.sin(fa * t + ph[0] + off) * Math.exp(-d1 * t) + 0.8 * Math.sin((fb + det) * t + ph[1]) * Math.exp(-d2 * t));
      const y = cy + A * (1.2 * Math.sin((fb + det * 0.5) * t + ph[2] + off) * Math.exp(-d1 * t) + 0.8 * Math.sin(fa * t + ph[3]) * Math.exp(-d2 * t));
      d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, [
      el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, opacity: p['opacity']! }),
    ]);
  },
});
