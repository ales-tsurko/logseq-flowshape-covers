import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

const MARGIN = 30;
const SAMPLES = 400;

export const chirp = definePattern({
  id: 'chirp',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['amplitude', 'freqStart', 'freqEnd', 'phaseStep', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'lineCount', kind: 'int', min: 12, max: 90, step: 1, default: 46, label: 'chirp.lineCount' },
    { key: 'freqStart', kind: 'float', min: 0, max: 20, step: 0.1, default: 1, label: 'chirp.freqStart' },
    { key: 'freqEnd', kind: 'float', min: 1, max: 120, step: 0.1, default: 42, label: 'chirp.freqEnd' },
    { key: 'amplitude', kind: 'float', min: 2, max: 60, step: 0.5, default: 16, label: 'chirp.amplitude' },
    { key: 'phaseStep', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.22, label: 'chirp.phaseStep' },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.4, label: 'chirp.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const lineCount = p['lineCount']!;
    const freqStart = p['freqStart']!;
    const freqEnd = p['freqEnd']!;
    const amplitude = p['amplitude']!;
    const phaseStep = p['phaseStep']!;
    const strokeWidth = p['strokeWidth']!;
    // The family is already phase-defined: advancing the accumulator by one
    // full turn per cycle makes the sweep travel and closes exactly, since
    // sin is 2*PI-periodic (and `% 1` pins phase 1 to phase 0 bit-for-bit).
    const drift = 2 * Math.PI * ((p['phase'] ?? 0) % 1);

    const W = size.w - 2 * MARGIN;
    // Inset the row band by the maximum envelope amplitude (reached at u=1,
    // where env = amplitude * (0.06 + 0.94) = amplitude) so the sine sweep
    // stays inside the frame at every amplitude instead of clipping the top
    // and bottom rows.
    const usableHeight = size.h - 2 * MARGIN - 2 * amplitude;
    const rowSpacing = usableHeight / Math.max(1, lineCount - 1);
    const yTop = MARGIN + amplitude;

    const children: SvgNode[] = [];
    for (let i = 0; i < lineCount; i++) {
      let d = '';
      for (let s = 0; s <= SAMPLES; s++) {
        const x = MARGIN + (W * s) / SAMPLES;
        const u = (x - MARGIN) / W;
        const phase = 2 * Math.PI * (freqStart * u + ((freqEnd - freqStart) * u * u) / 2);
        const env = amplitude * (0.06 + 0.94 * u * u);
        const y = yTop + i * rowSpacing + env * Math.sin(phase + i * phaseStep + drift);
        const xr = Math.round(x * 100) / 100;
        const yr = Math.round(y * 100) / 100;
        d += s === 0 ? `M${xr} ${yr}` : `L${xr} ${yr}`;
      }
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': strokeWidth }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
