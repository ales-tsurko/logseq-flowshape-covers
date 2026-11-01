import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Farris "mystery curves": z(t) = Σ Aₕ·e^{i(kₕt + φₕ)} where every
 * frequency satisfies kₕ ≡ 1 (mod m). That congruence is the whole
 * theorem — substituting t → t + 2π/m multiplies each term by e^{2πi/m},
 * so the curve maps onto itself rotated by exactly one m-th of a turn.
 * The symmetry is not tuned, it is forced; the phases φₕ are free, which
 * is why every seed is a different flourish with the same perfect order.
 */
export const mystery = definePattern({
  id: 'mystery',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['falloff', 'bloom', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'symmetry', kind: 'int', min: 3, max: 12, step: 1, default: 7, label: 'mystery.symmetry' },
    { key: 'harmonics', kind: 'int', min: 2, max: 8, step: 1, default: 6, label: 'mystery.harmonics' },
    { key: 'falloff', kind: 'float', min: 0.6, max: 2.5, step: 0.05, default: 1.05, label: 'mystery.falloff' },
    { key: 'bloom', kind: 'float', min: 0, max: 0.6, step: 0.02, default: 0.35, label: 'mystery.bloom' },
    { key: 'layers', kind: 'int', min: 1, max: 6, step: 1, default: 5, label: 'mystery.layers' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.5, label: 'mystery.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.65, label: 'mystery.opacity' },
  ],
  generate(p, seed, size) {
    const m = p['symmetry']!;
    const H = p['harmonics']!;
    const beta = p['falloff']!;
    const layers = p['layers']!;
    const rnd = mulberry32(deriveSeed(seed, 'mystery'));
    // Frequency plan: s = 0, 1, −1, 2, −2, … → k = 1 + m·s, all ≡ 1 (mod m).
    const svals: number[] = [];
    for (let h = 0; h < H; h++) svals.push(h === 0 ? 0 : (h % 2 === 1 ? (h + 1) / 2 : -h / 2));
    const freqs = svals.map((s) => 1 + m * s);
    const amps = svals.map((s) => 1 / Math.pow(1 + Math.abs(s), beta));
    const phis = svals.map(() => rnd() * 2 * Math.PI);
    const kMax = Math.max(...freqs.map((k) => Math.abs(k)));
    const N = Math.max(1024, 128 * kMax);
    const ph = (p['phase'] ?? 0) % 1;
    const bloom = p['bloom']!;
    const cx = size.w / 2, cy = size.h / 2;

    // Three exactly 1-periodic motions ride the phase together, and all
    // three vanish identically at ph = 0 (`% 1` above makes phase 1 the
    // literal phase-0 expression, closing the loop byte-for-byte):
    //  - spin: each harmonic's phase turns by 2π·s per cycle — whole turns,
    //    so the identity at the wrap; the curve morphs through its family.
    //  - bloom: each harmonic's amplitude swells by sin(2π·|s|·tw) — again
    //    integer rates, zero at the wrap; loops blossom and collapse at
    //    different beats instead of everything swirling in lockstep.
    //  - fan (below): the trail layers spread apart mid-cycle and close.
    // None of it touches the frequencies, so the m-fold symmetry survives
    // every frame — that is the Farris theorem doing the work.
    const point = (t: number, tw: number): [number, number] => {
      let x = 0, y = 0;
      for (let h = 0; h < svals.length; h++) {
        const rate = Math.max(1, Math.abs(svals[h]!));
        const amp = amps[h]! * (1 + bloom * Math.sin(2 * Math.PI * rate * tw));
        const a = freqs[h]! * t + phis[h]! + 2 * Math.PI * svals[h]! * tw;
        x += amp * Math.cos(a);
        y += amp * Math.sin(a);
      }
      return [x, y];
    };

    // The trail spacing: tight at the loop's anchor frame, fanning open to
    // more than double mid-cycle. (1 − cos) is zero at ph = 0, so the
    // still render and the wrap frame keep the resting spacing.
    const fan = 0.022 + 0.028 * ((1 - Math.cos(2 * Math.PI * ph)) / 2);

    // Normalize by the extremal radius across every layer, so neither the
    // bloom nor a fanned-out trail ever pushes the figure past the frame;
    // the scale is a continuous function of phase, so it breathes rather
    // than jumps.
    let maxR = 0;
    for (let L = 0; L < layers; L++) {
      for (let i = 0; i < N; i++) {
        const [x, y] = point((2 * Math.PI * i) / N, ph + L * fan);
        maxR = Math.max(maxR, Math.hypot(x, y));
      }
    }
    const R = (Math.min(size.w, size.h) * 0.44) / (maxR || 1);

    const children: SvgNode[] = [];
    for (let L = layers - 1; L >= 0; L--) {
      // Each layer is the same curve a little further along the phase
      // flow — an engraved motion-trail of the morph itself.
      const tw = ph + L * fan;
      let d = '';
      for (let i = 0; i <= N; i++) {
        const [x, y] = point((2 * Math.PI * i) / N, tw);
        d += `${i ? 'L' : 'M'}${(cx + R * x).toFixed(2)} ${(cy + R * y).toFixed(2)}`;
      }
      const op = p['opacity']! * (L === 0 ? 1 : Math.max(0.15, 1 - L / layers));
      children.push(el('path', {
        d, fill: 'none', stroke: 'ink',
        'stroke-width': p['strokeWidth']! * (L === 0 ? 1 : 0.8),
        opacity: Math.round(op * 1000) / 1000,
      }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
