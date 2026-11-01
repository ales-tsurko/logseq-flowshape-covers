import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

/**
 * Guilloché: the machine-turned engraving of bank notes and watch dials.
 * Each ring is r(t) = base + A·cos(q·t + χ) — exactly closed because q is
 * an integer — and the weave comes entirely from the twist χ advancing
 * ring to ring: adjacent rings' lobes interleave and the eye reads woven
 * metal where there are only phase-shifted cosines.
 */
export const guilloche = definePattern({
  id: 'guilloche',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['rings', 'depth', 'inner', 'twist', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'rings', kind: 'int', min: 4, max: 48, step: 1, default: 40, label: 'guilloche.rings' },
    { key: 'lobes', kind: 'int', min: 6, max: 90, step: 1, default: 12, label: 'guilloche.lobes' },
    { key: 'depth', kind: 'float', min: 0.02, max: 0.3, step: 0.005, default: 0.16, label: 'guilloche.depth' },
    { key: 'inner', kind: 'float', min: 0.1, max: 0.8, step: 0.01, default: 0.2, label: 'guilloche.inner' },
    { key: 'twist', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'guilloche.twist' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 1.5, step: 0.05, default: 0.4, label: 'guilloche.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.8, label: 'guilloche.opacity' },
  ],
  generate(p, _seed, size) {
    const rings = p['rings']!;
    const q = p['lobes']!;
    const cx = size.w / 2, cy = size.h / 2;
    const Rmax = Math.min(size.w, size.h) * 0.44;
    const A = p['depth']! * Rmax;
    // Bases span [inner, 1]·S with S chosen so the outermost lobe peaks
    // exactly at Rmax — the figure never leaves the frame at any depth.
    const S = Rmax - A;
    const inner = p['inner']!;
    // Twist is a fraction of one lobe spacing per ring: 0 aligns the lobes
    // into radial ridges, ~0.5 is maximal cross-weave, 1 wraps back to
    // aligned — the whole knob is periodic by construction.
    const dChi = p['twist']! * ((2 * Math.PI) / q);
    // Precession: the modulation angle gains a full 2π per phase cycle —
    // the weave slides by exactly one lobe and lands on itself (`% 1`
    // makes phase 1 the literal phase-0 expression).
    const phaseChi = ((p['phase'] ?? 0) % 1) * 2 * Math.PI;
    const samples = Math.max(720, 20 * q);
    const children: SvgNode[] = [];
    for (let k = 0; k < rings; k++) {
      const t = rings === 1 ? 1 : k / (rings - 1);
      const base = S * (inner + (1 - inner) * t);
      const chi = k * dChi + phaseChi;
      let d = '';
      for (let i = 0; i <= samples; i++) {
        const a = (2 * Math.PI * i) / samples;
        const r = base + A * Math.cos(q * a + chi);
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      d += 'Z';
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, opacity: p['opacity']! }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
