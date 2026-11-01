import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

export const truchet = definePattern({
  id: 'truchet',
  family: 'tilings',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['boldChance', 'accentChance', 'strokeWidth', 'size'] },
  params: [
    { key: 'cell', kind: 'int', min: 20, max: 80, step: 2, default: 30, label: 'truchet.cell' },
    { key: 'variant', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'truchet.variant', options: ['truchet.arcs', 'truchet.diagonals'] },
    { key: 'render', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'truchet.render', options: ['truchet.strokes', 'truchet.tiles'] },
    { key: 'strokeWidth', kind: 'float', min: 0.3, max: 6, step: 0.1, default: 1.0, label: 'truchet.strokeWidth', dependsOn: { key: 'render', values: [0] } },
    { key: 'boldChance', kind: 'float', min: 0, max: 0.3, step: 0.01, default: 0.12, label: 'truchet.boldChance', dependsOn: { key: 'render', values: [0] } },
    { key: 'accentChance', kind: 'float', min: 0, max: 0.2, step: 0.01, default: 0.04, label: 'truchet.accentChance', dependsOn: { key: 'render', values: [0] } },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'truchet'));
    const s = p['cell']!;
    const cols = Math.floor(size.w / s);
    const rows = Math.floor(size.h / s);
    const ox = (size.w - cols * s) / 2;
    const oy = (size.h - rows * s) / 2;
    const h = s / 2;
    const tiles = p['render']! === 1;
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    const children: SvgNode[] = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = ox + i * s, y = oy + j * s;
        const flip = rnd() > 0.5;
        const bold = rnd() < p['boldChance']!;
        const accent = rnd() < p['accentChance']!;
        if (tiles) {
          const X = r2(x), Y = r2(y), H = r2(h);
          const XH = r2(x + h), YH = r2(y + h), XS = r2(x + s), YS = r2(y + s);
          if (p['variant']! === 0) {
            // Classic two-tone Truchet fill: pie-slice quarter-discs at the
            // two corners the arcs curve around, leaving the other pair bare.
            if (flip) {
              children.push(el('path', { d: `M${X} ${YH}A${H} ${H} 0 0 1 ${XH} ${Y}L${X} ${Y}Z`, fill: 'ink', stroke: 'none' }));
              children.push(el('path', { d: `M${XH} ${YS}A${H} ${H} 0 0 1 ${XS} ${YH}L${XS} ${YS}Z`, fill: 'ink', stroke: 'none' }));
            } else {
              children.push(el('path', { d: `M${X} ${YH}A${H} ${H} 0 0 0 ${XH} ${YS}L${X} ${YS}Z`, fill: 'ink', stroke: 'none' }));
              children.push(el('path', { d: `M${XH} ${Y}A${H} ${H} 0 0 0 ${XS} ${YH}L${XS} ${Y}Z`, fill: 'ink', stroke: 'none' }));
            }
          } else {
            const d = flip
              ? `M${X} ${Y}L${XS} ${Y}L${XS} ${YS}Z`
              : `M${XS} ${Y}L${XS} ${YS}L${X} ${YS}Z`;
            children.push(el('path', { d, fill: 'ink', stroke: 'none' }));
          }
          continue;
        }
        let d: string;
        if (p['variant']! === 0) {
          d = flip
            ? `M${x} ${y + h}A${h} ${h} 0 0 1 ${x + h} ${y}M${x + h} ${y + s}A${h} ${h} 0 0 1 ${x + s} ${y + h}`
            : `M${x} ${y + h}A${h} ${h} 0 0 0 ${x + h} ${y + s}M${x + h} ${y}A${h} ${h} 0 0 0 ${x + s} ${y + h}`;
        } else {
          d = flip ? `M${x} ${y}L${x + s} ${y + s}` : `M${x + s} ${y}L${x} ${y + s}`;
        }
        children.push(el('path', {
          d,
          fill: 'none',
          stroke: accent ? 'accent' : 'ink',
          'stroke-width': bold ? p['strokeWidth']! * 2 : p['strokeWidth']!,
          'stroke-linecap': 'round',
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
