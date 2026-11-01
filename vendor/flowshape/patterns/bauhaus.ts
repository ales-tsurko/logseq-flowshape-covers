import { el, type SvgNode } from '../core/svg';
import { definePattern, type Params } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/**
 * Bauhaus stripe tiles.
 *
 * Every glyph is a bundle of N parallel stripes, each an offset curve of one
 * base curve inside a square cell: a line between opposite sides, or a
 * corner connector between adjacent sides — a quarter arc, its straight
 * chord (a chamfer), or the L-shaped elbow that nests into squares. Stripe k
 * meets every side of its cell at the same fraction t_k = (k + ½)/N along
 * that side, so any glyph continues into any neighbour across any edge, in
 * any rotation or reflection. That one constraint is what makes the family
 * tile; the `truchet` pattern is its N = 1 special case.
 *
 * The drawing is not done cell by cell. Chasing side → neighbour side across
 * the grid traces every BAND CHAIN — the route one bundle takes from border
 * to border, or around a closed loop. A stripe is then defined by the
 * position at which it crosses the chain's entry edge and propagated step
 * by step: a line keeps that position, a corner connector maps it through
 * `r = p` or `1 − p` depending on which end of the side its corner sits on.
 * This is what lets the whole field slide (see `phase`) without a single
 * seam: the shift is applied to the entry position, and the propagation
 * keeps every crossing matched on both sides of every edge.
 *
 * Motion: all stripes slide laterally along their band by a shared phase,
 * λ_k = ((k + ½)/N + phase) mod 1. Under mirrors this reads as rings
 * radiating from every disc centre; on pipes, as the band rolling. `% 1`
 * folds phase 1 onto 0, so a full cycle is the phase-0 expression byte
 * for byte.
 *
 * A closed chain always returns a stripe to its own position: a ribbon
 * along a closed curve in the plane has a trivial normal bundle, so there
 * is no Möbius loop to obstruct the shift. An earlier version of the
 * tracer reported such loops. They were an artefact: a chain between two
 * dead ends (an H or V glyph leaves two sides unused) was walked from a
 * mid-point in one direction only, and the walk in the other direction
 * later stopped at the first chain's start and was labelled "closed". Now
 * a chain is walked both ways from wherever it is found, "closed" means
 * returning to the start segment, and `tests/patterns/bauhaus.test.ts`
 * asserts the round trip is the identity on every loop.
 *
 * Symmetry extends a seeded m×m block into the plane: pmm mirrors it across
 * both axes (four quarter discs fuse into one disc), p4m adds the diagonal
 * mirror (nested diamonds appear where diagonal stripes meet), p4 rotates it
 * about the supercell centre. `repeat` is m; 0 means "every cell its own"
 * under no symmetry and a 2×2 block under any.
 */

type Side = 0 | 1 | 2 | 3; // top, right, bottom, left
type Pt = readonly [number, number];
type Kind = 'line' | 'arc' | 'chamfer' | 'bend';
interface Prim { kind: Kind; sides: readonly [Side, Side]; corner?: Pt; over?: boolean }

/** Base curves per glyph, in the unrotated cell. */
const GLYPHS: Record<string, readonly Prim[]> = {
  arcA: [{ kind: 'arc', corner: [0, 0], sides: [0, 3] }, { kind: 'arc', corner: [1, 1], sides: [2, 1] }],
  arcB: [{ kind: 'arc', corner: [1, 0], sides: [0, 1] }, { kind: 'arc', corner: [0, 1], sides: [2, 3] }],
  H: [{ kind: 'line', sides: [3, 1] }],
  V: [{ kind: 'line', sides: [0, 2] }],
  cross: [{ kind: 'line', sides: [0, 2] }, { kind: 'line', sides: [3, 1], over: true }],
  chamferA: [{ kind: 'chamfer', corner: [0, 1], sides: [3, 2] }, { kind: 'chamfer', corner: [1, 0], sides: [0, 1] }],
  chamferB: [{ kind: 'chamfer', corner: [0, 0], sides: [3, 0] }, { kind: 'chamfer', corner: [1, 1], sides: [2, 1] }],
  bend: [{ kind: 'bend', corner: [0, 0], sides: [0, 3] }],
  qdisc: [{ kind: 'arc', corner: [0, 0], sides: [0, 3] }],
};

/** Motif enum → alphabet. Index 8 (dots) is not stripe-based; see `dots()`. */
const MOTIFS: readonly (readonly string[])[] = [
  ['arcA', 'arcB', 'H', 'V', 'cross'], // pipes
  ['arcA', 'arcB'],                    // arcs
  ['qdisc'],                           // discs
  ['qdisc'],                           // corner discs (+ solid square)
  ['chamferA', 'chamferB', 'bend'],    // chevrons
  ['bend'],                            // diamonds
  ['H', 'V'],                          // hatch
  ['arcA', 'arcB', 'cross'],           // knot
  [],                                  // dots
];
const MOTIF_CORNER_DISCS = 3;
const MOTIF_DOTS = 8;
const STRIPE_MOTIFS = [0, 1, 2, 3, 4, 5, 6, 7];

/** A cell's placement: its own rotation, then the symmetry group's transform. */
interface Xf { rot: number; transpose: boolean; rot2: number; fx: boolean; fy: boolean }

function rotSide(s: Side): Side { return ((s + 1) % 4) as Side; }
function rotPt(p: Pt): Pt { return [1 - p[1], p[0]]; }

function xfPrim(p: Prim, xf: Xf): Prim {
  let sides: [Side, Side] = [p.sides[0], p.sides[1]];
  let corner = p.corner;
  for (let i = 0; i < xf.rot; i++) { sides = [rotSide(sides[0]), rotSide(sides[1])]; if (corner) corner = rotPt(corner); }
  if (xf.transpose) {
    const t = (s: Side): Side => (s === 0 ? 3 : s === 3 ? 0 : s === 1 ? 2 : 1);
    sides = [t(sides[0]), t(sides[1])]; if (corner) corner = [corner[1], corner[0]];
  }
  for (let i = 0; i < xf.rot2; i++) { sides = [rotSide(sides[0]), rotSide(sides[1])]; if (corner) corner = rotPt(corner); }
  if (xf.fx) { const f = (s: Side): Side => (s === 1 ? 3 : s === 3 ? 1 : s); sides = [f(sides[0]), f(sides[1])]; if (corner) corner = [1 - corner[0], corner[1]]; }
  if (xf.fy) { const f = (s: Side): Side => (s === 0 ? 2 : s === 2 ? 0 : s); sides = [f(sides[0]), f(sides[1])]; if (corner) corner = [corner[0], 1 - corner[1]]; }
  const out: Prim = { kind: p.kind, sides };
  if (corner) out.corner = corner;
  if (p.over) out.over = true;
  return out;
}

function xfPt(p: Pt, xf: Xf): Pt {
  let q = p;
  for (let i = 0; i < xf.rot; i++) q = rotPt(q);
  if (xf.transpose) q = [q[1], q[0]];
  for (let i = 0; i < xf.rot2; i++) q = rotPt(q);
  if (xf.fx) q = [1 - q[0], q[1]];
  if (xf.fy) q = [q[0], 1 - q[1]];
  return q;
}

const START_CORNER: readonly Pt[] = [[0, 0], [1, 0], [0, 1], [0, 0]];
const cornerAtStart = (c: Pt, side: Side): boolean => c[0] === START_CORNER[side]![0] && c[1] === START_CORNER[side]![1];
const portPt = (side: Side, p: number): Pt => (side === 0 ? [p, 0] : side === 1 ? [1, p] : side === 2 ? [p, 1] : [0, p]);
/** side → [dI, dJ, the neighbour's facing side] */
const ACROSS: readonly (readonly [number, number, Side])[] = [[0, -1, 2], [1, 0, 3], [0, 1, 0], [-1, 0, 1]];

interface Cell { I: number; J: number; prims: readonly Prim[]; xf: Xf; glyph: string; bar: boolean }
interface Step { cell: Cell; prim: Prim; sin: Side; sout: Side }
interface Chain { steps: Step[]; closed: boolean; flipStart: boolean; frozen: boolean }

/** Where a stripe leaves a step, given where it entered. */
function propagate(st: Step, p: number): number {
  if (st.prim.kind === 'line') return p;
  const c = st.prim.corner!;
  const r = cornerAtStart(c, st.sin) ? p : 1 - p;
  return cornerAtStart(c, st.sout) ? r : 1 - r;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The placed grid: one Cell per position, glyph and transform decided by
 *  the seeded block and the symmetry group. Exported for the tests. */
export function buildCells(p: Params, seed: number, cols: number, rows: number): Cell[] {
    const motif = p['motif']!;
    const symmetry = p['symmetry']!;
    const alphabet = MOTIFS[motif]!;
    const m = p['repeat']! === 0 ? (symmetry === 0 ? Infinity : 2) : p['repeat']!;

    // The seeded block: one independent stream per block cell, so `repeat`
    // changes which cells are copies, never what a cell holds.
    const blockCache = new Map<string, { glyph: string; rot: number; bar: boolean }>();
    const blockCell = (i: number, j: number): { glyph: string; rot: number; bar: boolean } => {
      const key = `${i},${j}`;
      let b = blockCache.get(key);
      if (!b) {
        const rnd = mulberry32(deriveSeed(seed, `bauhaus-${i}-${j}`));
        const glyph = alphabet.length ? alphabet[Math.floor(rnd() * alphabet.length)]! : 'dot';
        let rot = Math.floor(rnd() * 4);
        // Discs under no symmetry: face the 2×2 block centre most of the time,
        // so quarter arcs still fuse into discs without mirrors.
        if (glyph === 'qdisc' && symmetry === 0 && rnd() < 0.75) {
          const a = ((i % 2) + 2) % 2, bb = ((j % 2) + 2) % 2;
          rot = a === 0 && bb === 0 ? 2 : a === 1 && bb === 0 ? 3 : a === 0 && bb === 1 ? 1 : 0;
        }
        b = { glyph, rot, bar: rnd() < 0.6 };
        blockCache.set(key, b);
      }
      return b;
    };

    const cells: Cell[] = [];
    for (let J = 0; J < rows; J++) for (let I = 0; I < cols; I++) {
      let i: number, j: number;
      const xf: Xf = { rot: 0, transpose: false, rot2: 0, fx: false, fy: false };
      if (symmetry === 0) {
        i = m === Infinity ? I : I % m; j = m === Infinity ? J : J % m;
      } else {
        const P = 2 * m, a = I % P, b = J % P;
        if (symmetry === 3) {
          // p4: quadrant → quarter turns about the supercell centre, and the
          // cell's block coordinates are found by turning it back.
          const q = (a >= m ? 1 : 0) + (b >= m ? 2 : 0);
          const rot = [0, 1, 3, 2][q]!;
          let x = a, y = b;
          for (let k = 0; k < rot; k++) { const nx = y, ny = P - 1 - x; x = nx; y = ny; }
          i = x; j = y; xf.rot2 = rot;
        } else {
          i = a < m ? a : P - 1 - a; j = b < m ? b : P - 1 - b;
          xf.fx = a >= m; xf.fy = b >= m;
          if (symmetry === 2 && i < j) { xf.transpose = true; const t = i; i = j; j = t; }
        }
      }
      const b = blockCell(i, j);
      xf.rot = b.rot;
      const prims = (GLYPHS[b.glyph] ?? []).map((pr) => xfPrim(pr, xf));
      cells.push({ I, J, prims, xf, glyph: b.glyph, bar: b.bar });
    }
    return cells;
}

/**
 * Every band chain of a placed grid. A chain is walked from wherever it is
 * first met, in both directions when it is open, so it always runs from one
 * end to the other: a border or a dead end (a side the neighbouring glyph
 * does not use). "Closed" means the walk came back to its own start segment.
 * Exported for the tests, which assert that no closed chain reverses a
 * stripe on a round trip.
 */
export function traceChains(cells: readonly Cell[], cols: number, rows: number): Chain[] {
    const cellAt = (I: number, J: number): Cell | null => (I < 0 || J < 0 || I >= cols || J >= rows ? null : cells[J * cols + I]!);
    const primBySide = (cell: Cell, side: Side): Prim | undefined => cell.prims.find((pr) => pr.sides.includes(side));
    const visited = new Set<string>();
    const key = (cell: Cell, prim: Prim): string => `${cell.J * cols + cell.I}:${cell.prims.indexOf(prim)}`;
    const walk = (cell: Cell, prim: Prim, sin: Side): { steps: Step[]; closed: boolean } => {
      const start = prim;
      const steps: Step[] = [];
      let closed = false;
      for (;;) {
        visited.add(key(cell, prim));
        const sout = prim.sides[0] === sin ? prim.sides[1] : prim.sides[0];
        steps.push({ cell, prim, sin, sout });
        const [dI, dJ, ns] = ACROSS[sout]!;
        const nb = cellAt(cell.I + dI, cell.J + dJ);
        if (!nb) break;
        const np = primBySide(nb, ns);
        if (!np) break;
        if (np === start) { closed = true; break; }
        cell = nb; prim = np; sin = ns;
      }
      return { steps, closed };
    };
    const finish = (steps: Step[], closed: boolean): Chain => {
      const first = steps[0]!;
      const flipStart = first.prim.kind !== 'line' && !cornerAtStart(first.prim.corner!, first.sin);
      let frozen = false;
      if (closed) { let q = 0.25; for (const st of steps) q = propagate(st, q); frozen = Math.abs(q - 0.25) > 1e-9; }
      return { steps, closed, flipStart, frozen };
    };
    const chains: Chain[] = [];
    for (const cell of cells) {
      const sides: Side[] = [];
      if (cell.J === 0) sides.push(0); if (cell.I === cols - 1) sides.push(1);
      if (cell.J === rows - 1) sides.push(2); if (cell.I === 0) sides.push(3);
      for (const s of sides) { const pr = primBySide(cell, s); if (pr && !visited.has(key(cell, pr))) { const w = walk(cell, pr, s); chains.push(finish(w.steps, w.closed)); } }
    }
    for (const cell of cells) for (const pr of cell.prims) {
      if (visited.has(key(cell, pr))) continue;
      const fwd = walk(cell, pr, pr.sides[0]);
      if (fwd.closed) { chains.push(finish(fwd.steps, true)); continue; }
      // Open in this direction, so open in the other too: walk it and stitch,
      // so the chain runs end to end and one stripe bookkeeping covers it.
      const back = walk(cell, pr, pr.sides[1]);
      const rev: Step[] = back.steps.slice(1).reverse().map((st) => ({ cell: st.cell, prim: st.prim, sin: st.sout, sout: st.sin }));
      chains.push(finish([...rev, ...fwd.steps], false));
    }
    return chains;
}

export const bauhaus = definePattern({
  id: 'bauhaus',
  family: 'tilings',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['width', 'tilt', 'size'], usesPhase: true },
  params: [
    { key: 'motif', kind: 'enum', min: 0, max: 8, step: 1, default: 7, label: 'bauhaus.motif',
      options: ['bauhaus.pipes', 'bauhaus.arcs', 'bauhaus.discs', 'bauhaus.cornerDiscs', 'bauhaus.chevrons', 'bauhaus.diamonds', 'bauhaus.hatch', 'bauhaus.knot', 'bauhaus.dots'] },
    { key: 'symmetry', kind: 'enum', min: 0, max: 3, step: 1, default: 3, label: 'bauhaus.symmetry',
      options: ['bauhaus.free', 'bauhaus.pmm', 'bauhaus.p4m', 'bauhaus.p4'] },
    { key: 'cell', kind: 'int', min: 30, max: 150, step: 5, default: 65, label: 'bauhaus.cell' },
    { key: 'repeat', kind: 'int', min: 0, max: 6, step: 1, default: 5, label: 'bauhaus.repeat' },
    { key: 'stripes', kind: 'int', min: 1, max: 12, step: 1, default: 8, label: 'bauhaus.stripes', dependsOn: { key: 'motif', values: STRIPE_MOTIFS } },
    { key: 'render', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'bauhaus.render', options: ['bauhaus.strokes', 'bauhaus.bands'], dependsOn: { key: 'motif', values: STRIPE_MOTIFS } },
    { key: 'width', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.42, label: 'bauhaus.width', dependsOn: { key: 'render', values: [0] } },
    { key: 'tilt', kind: 'float', min: -1, max: 1, step: 0.05, default: -0.25, label: 'bauhaus.tilt', dependsOn: { key: 'motif', values: STRIPE_MOTIFS } },
    { key: 'accentEvery', kind: 'int', min: 0, max: 9, step: 1, default: 5, label: 'bauhaus.accentEvery', dependsOn: { key: 'motif', values: STRIPE_MOTIFS } },
  ],
  generate(p, seed, size) {
    const motif = p['motif']!;
    const cellPx = p['cell']!;
    const cols = Math.max(1, Math.floor(size.w / cellPx));
    const rows = Math.max(1, Math.floor(size.h / cellPx));
    const ox = (size.w - cols * cellPx) / 2;
    const oy = (size.h - rows * cellPx) / 2;
    const cells = buildCells(p, seed, cols, rows);

    const children: SvgNode[] = [];
    const px = (cell: Cell, q: Pt): Pt => [ox + (cell.I + q[0]) * cellPx, oy + (cell.J + q[1]) * cellPx];

    if (motif === MOTIF_DOTS) {
      // Discs on cell centres, joined to a diagonal neighbour by a capsule.
      let bars = '';
      for (const c of cells) {
        const [cx, cy] = px(c, [0.5, 0.5]);
        children.push(el('circle', { cx: r2(cx), cy: r2(cy), r: r2(cellPx * 0.3), fill: 'ink' }));
        if (c.bar) { const [ex, ey] = px(c, xfPt([1.5, 1.5], c.xf)); bars += `M${r2(cx)} ${r2(cy)}L${r2(ex)} ${r2(ey)}`; }
      }
      if (bars) children.push(el('path', { d: bars, fill: 'none', stroke: 'ink', 'stroke-width': r2(cellPx * 0.4), 'stroke-linecap': 'round' }));
      return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
    }

    const chains = traceChains(cells, cols, rows);

    // ---- emit stripes, bucketed by (k, thin, over, accent) ----
    const N = p['stripes']!;
    const bands = p['render']! === 1;
    const pitch = cellPx / N;
    const ph = (p['phase'] ?? 0) % 1;
    const accentEvery = p['accentEvery']!;
    const tilt = p['tilt']!;
    // A stripe's weight, tapered to nothing at the band edges. As stripes
    // slide with phase, one reaches λ = 1 and re-enters at λ = 0 — a jump
    // the eye read as a field-wide tick every 1/N of a cycle, unrelated to
    // the music. The taper spans the outer half-lane on each side, so the
    // stripe fades out and is born thin instead. At rest, λ_k = (k + ½)/N
    // sits exactly at the taper's edge for the outermost stripes, so the
    // factor is 1 for every k and phase 0 renders as it always did.
    const widthOf = (k: number, thin: boolean, lam: number): number => {
      const base = bands ? pitch : pitch * p['width']!;
      const w = base * (1 + tilt * (2 * (k + 0.5) / N - 1));
      const taper = Math.min(1, Math.min(lam, 1 - lam) * 2 * N + 1e-9);
      return Math.max(pitch * 0.05, w) * (thin ? Math.SQRT1_2 : 1) * taper;
    };
    // bucket id → d
    const buckets = new Map<string, string>();
    const add = (id: string, d: string): void => { buckets.set(id, (buckets.get(id) ?? '') + d); };
    let halo = '';
    const solids: string[] = [];

    // The halo that cuts the under-band at a crossing covers the whole cell
    // along the over-line's centreline, and never moves. It was once one
    // stroke per lane, following the lanes as they slide — so every time a
    // lane wrapped from one band edge to the other the cut jumped with it,
    // a field-wide tick every 1/N of a cycle with no music behind it.
    for (const c of cells) for (const pr of c.prims) {
      if (!pr.over) continue;
      const A = px(c, portPt(pr.sides[0], 0.5)), B = px(c, portPt(pr.sides[1], 0.5));
      halo += `M${r2(A[0])} ${r2(A[1])}L${r2(B[0])} ${r2(B[1])}`;
    }
    chains.forEach((chain, ci) => {
      const accent = accentEvery > 0 && ci % accentEvery === 0;
      const shift = chain.frozen ? 0 : ph;
      for (let k = 0; k < N; k++) {
        // In bands mode odd lanes stay paper, but their halo segments are
        // still needed so the under-band is cut across the whole crossing.
        const drawn = !(bands && k % 2 === 1);
        const lam = ((k + 0.5) / N + shift) % 1;
        let q = chain.flipStart ? 1 - lam : lam;
        for (const st of chain.steps) {
          const A = px(st.cell, portPt(st.sin, q));
          const qout = propagate(st, q);
          const B = px(st.cell, portPt(st.sout, qout));
          if (!drawn) { q = qout; continue; }
          let d: string;
          if (st.prim.kind === 'line' || st.prim.kind === 'chamfer') {
            d = `M${r2(A[0])} ${r2(A[1])}L${r2(B[0])} ${r2(B[1])}`;
          } else {
            const c = st.prim.corner!;
            const C = px(st.cell, c);
            if (st.prim.kind === 'bend') {
              const r = cornerAtStart(c, st.sin) ? q : 1 - q;
              const E = px(st.cell, [c[0] + (c[0] === 0 ? r : -r), c[1] + (c[1] === 0 ? r : -r)]);
              d = `M${r2(A[0])} ${r2(A[1])}L${r2(E[0])} ${r2(E[1])}L${r2(B[0])} ${r2(B[1])}`;
            } else {
              const r = Math.hypot(A[0] - C[0], A[1] - C[1]);
              const z = (A[0] - C[0]) * (B[1] - C[1]) - (A[1] - C[1]) * (B[0] - C[0]);
              d = `M${r2(A[0])} ${r2(A[1])}A${r2(r)} ${r2(r)} 0 0 ${z > 0 ? 1 : 0} ${r2(B[0])} ${r2(B[1])}`;
            }
          }
          const thin = st.prim.kind === 'chamfer';
          add(`${k}|${thin ? 1 : 0}|${st.prim.over ? 1 : 0}|${accent ? 1 : 0}|${chain.frozen ? 1 : 0}`, d);
          q = qout;
        }
      }
    });

    if (motif === MOTIF_CORNER_DISCS) {
      for (const c of cells) {
        const SQUARE: readonly Pt[] = [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]];
        const q = SQUARE.map((u) => px(c, xfPt(u, c.xf)));
        solids.push(`M${q.map((v) => `${r2(v[0])} ${r2(v[1])}`).join('L')}Z`);
      }
    }

    const emit = (over: boolean): void => {
      for (let k = 0; k < N; k++) for (const thin of [false, true]) for (const accent of [false, true]) for (const frozen of [false, true]) {
        const d = buckets.get(`${k}|${thin ? 1 : 0}|${over ? 1 : 0}|${accent ? 1 : 0}|${frozen ? 1 : 0}`);
        if (!d) continue;
        const lam = ((k + 0.5) / N + (frozen ? 0 : ph)) % 1;
        const sw = r2(widthOf(k, thin, lam));
        // A stripe tapered to nothing is not emitted at all. SVG would draw
        // nothing for stroke-width 0, but the canvas API ignores a zero line
        // width and keeps the previous one — which, right after the halo, is
        // a full cell: the vanishing stripe came back as an ink square.
        if (sw <= 0) continue;
        children.push(el('path', { d, fill: 'none', stroke: accent ? 'accent' : 'ink', 'stroke-width': sw }));
      }
    };
    emit(false);
    if (halo) children.push(el('path', { d: halo, fill: 'none', stroke: 'paper', 'stroke-width': cellPx }));
    emit(true);
    if (solids.length) children.push(el('path', { d: solids.join(''), fill: 'ink', stroke: 'none' }));
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
