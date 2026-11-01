import { el } from '../core/svg';
import { definePattern } from './registry';

export const girih = definePattern({
  id: 'girih',
  family: 'tilings',
  phase: 1,
  heavy: false,
  anim: { continuous: ['contactAngle', 'ribbonWidth', 'strokeWidth', 'size'] },
  params: [
    { key: 'hexSize', kind: 'int', min: 20, max: 80, step: 2, default: 30, label: 'girih.hexSize' },
    { key: 'contactAngle', kind: 'float', min: 15, max: 80, step: 0.5, default: 60, label: 'girih.contactAngle' },
    { key: 'render', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'girih.render', options: ['girih.strokes', 'girih.ribbons'] },
    { key: 'ribbonWidth', kind: 'float', min: 2, max: 20, step: 0.5, default: 9, label: 'girih.ribbonWidth', dependsOn: { key: 'render', values: [1] } },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 5, step: 0.1, default: 0.9, label: 'girih.strokeWidth', dependsOn: { key: 'render', values: [0] } },
  ],
  generate(p, _seed, size) {
    const S = p['hexSize']!;
    const TH = (p['contactAngle']! * Math.PI) / 180;
    const ct = Math.cos(TH), st = Math.sin(TH);
    const cross = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];
    let d = '';
    const f2 = (n: number) => n.toFixed(2);
    const rMax = Math.ceil(size.h / (S * 1.5)) + 1;
    const qMax = Math.ceil(size.w / (S * Math.sqrt(3))) + 2;
    for (let r = -1; r <= rMax; r++) {
      for (let q = -qMax; q <= qMax; q++) {
        const hx = S * Math.sqrt(3) * (q + r / 2);
        const hy = S * 1.5 * r;
        if (hx < -S || hx > size.w + S || hy < -S || hy > size.h + S) continue;
        const V: [number, number][] = [];
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          V.push([hx + S * Math.cos(a), hy + S * Math.sin(a)]);
        }
        const M: [number, number][] = [], E: [number, number][] = [], N: [number, number][] = [];
        for (let k = 0; k < 6; k++) {
          const v1 = V[k]!, v2 = V[(k + 1) % 6]!;
          const mx = (v1[0] + v2[0]) / 2, my = (v1[1] + v2[1]) / 2;
          M.push([mx, my]);
          const elen = Math.hypot(v2[0] - v1[0], v2[1] - v1[1]);
          E.push([(v2[0] - v1[0]) / elen, (v2[1] - v1[1]) / elen]);
          const nlen = Math.hypot(hx - mx, hy - my);
          N.push([(hx - mx) / nlen, (hy - my) / nlen]);
        }
        for (let k = 0; k < 6; k++) {
          const k2 = (k + 1) % 6;
          const d1: [number, number] = [E[k]![0] * ct + N[k]![0] * st, E[k]![1] * ct + N[k]![1] * st];
          const d2: [number, number] = [-E[k2]![0] * ct + N[k2]![0] * st, -E[k2]![1] * ct + N[k2]![1] * st];
          const dm: [number, number] = [M[k2]![0] - M[k]![0], M[k2]![1] - M[k]![1]];
          const den = cross(d1, d2);
          if (Math.abs(den) < 1e-9) continue;
          const t = cross(dm, d2) / den;
          if (t <= 0 || t > S * 2) continue;
          const P: [number, number] = [M[k]![0] + d1[0] * t, M[k]![1] + d1[1] * t];
          d += `M${f2(M[k]![0])} ${f2(M[k]![1])}L${f2(P[0])} ${f2(P[1])}L${f2(M[k2]![0])} ${f2(M[k2]![1])}`;
        }
      }
    }
    if (p['render']! === 1) {
      const rw = p['ribbonWidth']!;
      return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, [
        el('path', {
          d, fill: 'none', stroke: 'ink',
          'stroke-width': rw, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }),
        el('path', {
          d, fill: 'none', stroke: 'paper',
          'stroke-width': rw * 0.45, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        }),
      ]);
    }

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, [
      el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, 'stroke-linecap': 'round' }),
    ]);
  },
});
