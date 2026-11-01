import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Dash-periods of travel per phase cycle. A hitomezashi line's dash pattern
 * — `(j + bit) % 2 === 0` — is 2-cell periodic along the line, so sliding the
 * dashes by a whole number of 2-cell periods maps the field exactly onto
 * itself. That is what makes the drift below a genuine seamless loop rather
 * than an approximate one: at phase 1 the emitted stitch set is identical to
 * phase 0's, bit for bit, with no re-drawing of a single random bit.
 */
const LAPS = 8;
/** Cells of travel per cycle. Two per lap (the dash period is two cells). */
const TRAVEL = LAPS * 2;
/** 2dp, so a fractional inset does not bloat the path string.
 *  Integer insets (the default) print unchanged. */
const r2 = (n: number): number => Math.round(n * 100) / 100;

export const hitomezashi = definePattern({
  id: 'hitomezashi',
  family: 'tilings',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['stitchLen', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'cell', kind: 'int', min: 8, max: 30, step: 1, default: 12, label: 'hitomezashi.cell' },
    { key: 'bitChance', kind: 'float', min: 0.2, max: 0.8, step: 0.01, default: 0.5, label: 'hitomezashi.bitChance' },
    // The one CONTINUOUS STRUCTURAL axis this pattern has. The stitch was
    // always inset a hard 1px from each end of its cell; that inset is now
    // interpolated from that 1px up to nearly half the cell, so the dash
    // shortens smoothly
    // toward the middle of its cell as the value falls. At the default 1 the
    // formula yields max(1, 0) = 1 — the exact previous expression, so every
    // existing URL renders byte-identically and the committed snapshot does
    // not move.
    //
    // Why it matters: the stage-fitness audit measured this pattern as having
    // ZERO smooth structural params — audio could reach only stroke weight and
    // scale, which is why Jossi heard "little changes" from it. A grid whose
    // dashes breathe between full stitches and sparse ticks gives the music
    // something structural to move, without touching the bit lattice that
    // makes the pattern what it is.
    { key: 'stitchLen', kind: 'float', min: 0.2, max: 1, step: 0.02, default: 1, label: 'hitomezashi.stitchLen' },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 4, step: 0.1, default: 0.7, label: 'hitomezashi.strokeWidth' },
    { key: 'fillParity', kind: 'bool', min: 0, max: 1, step: 1, default: 1, label: 'hitomezashi.fillParity' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'hitomezashi'));
    const cell = p['cell']!;
    const cols = Math.floor(size.w / cell);
    const rows = Math.floor(size.h / cell);
    const ox = (size.w - cols * cell) / 2;
    const oy = (size.h - rows * cell) / 2;
    const cb: number[] = [], rb: number[] = [];
    for (let i = 0; i <= cols; i++) cb.push(rnd() < p['bitChance']! ? 1 : 0);
    for (let j = 0; j <= rows; j++) rb.push(rnd() < p['bitChance']! ? 1 : 0);
    const children: SvgNode[] = [];
    if (p['fillParity']! === 1) {
      const xc = [0]; for (let i = 0; i < cols; i++) xc.push(xc[i]! ^ cb[i]!);
      const yr = [0]; for (let j = 0; j < rows; j++) yr.push(yr[j]! ^ rb[j]!);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if ((xc[i]! ^ yr[j]!) === 1) {
          children.push(el('rect', { x: ox + i * cell, y: oy + j * cell, width: cell, height: cell, fill: 'accent', opacity: 0.25 }));
        }
      }
    }
    // Intrinsic motion: the stitch field scrolls diagonally while the lattice
    // itself — the column and row lines, and the parity fill that marks the
    // pattern's region structure — stays exactly where it is. Vertical
    // stitches slide DOWN their own columns, horizontal stitches slide RIGHT
    // along their own rows: each family travels along the direction it is
    // drawn in, which is the only translation that keeps every stitch on its
    // own grid line. The two families sliding past each other lock back into
    // register every whole cell (four times a cycle at LAPS = 2), alternating
    // between the bit pattern and its exact complement.
    //
    // `% 1` folds phase 1 onto 0, so phase 1 is literally the phase-0
    // expression, and adding a drift of 0 is the exact float identity — the
    // committed snapshots (phase 0, default params) are untouched.
    const drift = ((p['phase'] ?? 0) % 1) * TRAVEL * cell;
    // Stitches that have scrolled out of the drawn band are dropped and the
    // ones scrolling in are picked up, so the field is full at every phase.
    // At drift 0 the extended indices all fall outside the band, leaving the
    // original emission order exactly as it was.
    // Half the material trimmed from each end of a stitch (see `stitchLen`).
    // Interpolates from the historical 1px at stitchLen 1 to nearly half the
    // cell at the minimum — NOT `max(1, cell(1−s)/2)`, which was the first
    // formulation and had a dead zone: at the default cell that expression
    // stays pinned at 1 until s falls below 0.83, so a sixth of the slider
    // did nothing. Every step of this one moves the drawing.
    const inset = 1 + (cell / 2 - 1) * (1 - p['stitchLen']!);
    const bandY = oy + rows * cell;
    const bandX = ox + cols * cell;
    let d = '';
    for (let i = 0; i <= cols; i++) for (let j = -TRAVEL; j < rows; j++) {
      if (((j + cb[i]!) % 2 + 2) % 2 !== 0) continue;
      const y0 = oy + j * cell + drift;
      const y1 = oy + (j + 1) * cell + drift;
      if (y1 - inset <= oy || y0 + inset >= bandY) continue;
      d += `M${ox + i * cell} ${r2(y0 + inset)}V${r2(y1 - inset)}`;
    }
    for (let j = 0; j <= rows; j++) for (let i = -TRAVEL; i < cols; i++) {
      if (((i + rb[j]!) % 2 + 2) % 2 !== 0) continue;
      const x0 = ox + i * cell + drift;
      const x1 = ox + (i + 1) * cell + drift;
      if (x1 - inset <= ox || x0 + inset >= bandX) continue;
      d += `M${r2(x0 + inset)} ${oy + j * cell}H${r2(x1 - inset)}`;
    }
    children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, 'stroke-linecap': 'round' }));
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
