import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

export const timestable = definePattern({
  id: 'timestable',
  family: 'curves',
  phase: 1,
  heavy: false,
  anim: { continuous: ['multiplier', 'opacity', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'chords', kind: 'int', min: 100, max: 600, step: 10, default: 400, label: 'timestable.chords' },
    { key: 'multiplier', kind: 'float', min: 2, max: 100, step: 0.05, default: 34, label: 'timestable.multiplier' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.35, label: 'timestable.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.05, max: 1, step: 0.01, default: 0.5, label: 'timestable.opacity' },
    { key: 'showCircle', kind: 'bool', min: 0, max: 1, step: 1, default: 1, label: 'timestable.showCircle' },
  ],
  generate(p, _seed, size) {
    const N = p['chords']!;
    // Phase sweeps the multiplier by exactly one integer and back — the
    // cardioid -> nephroid -> cardioid morph this family is known for.
    // A *monotone* one-integer sweep would not close the loop: chord
    // endpoints are k*M taken mod N, so the figure is only truly periodic
    // in M with period N (= `chords`, 400 by default), and travelling 400
    // multipliers per cycle would strobe rather than move. The cosine
    // ping-pong is the honest compromise: one integer of travel, exactly
    // equal at phase 0 and 1, and eased at both ends so it dwells on the
    // crisp integer envelopes and smears through the space between them.
    const ph = (p['phase'] ?? 0) % 1;
    const M = p['multiplier']! + (1 - Math.cos(2 * Math.PI * ph)) / 2;
    const cx = size.w / 2, cy = size.h / 2;
    const R = Math.min(size.w, size.h) * 0.42;
    const pt = (k: number): [number, number] => {
      const a = (2 * Math.PI * k) / N - Math.PI / 2;
      return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
    };
    let d = '';
    for (let k = 0; k < N; k++) {
      const [x1, y1] = pt(k);
      const [x2, y2] = pt((k * M) % N);
      d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }
    const children: SvgNode[] = [
      el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, opacity: p['opacity']! }),
    ];
    if (p['showCircle']! === 1) {
      children.push(el('circle', { cx, cy, r: R, fill: 'none', stroke: 'ink', 'stroke-width': 1, opacity: 0.5 }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
