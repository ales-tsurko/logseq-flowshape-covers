import { el, type SvgNode } from '../core/svg';
import { definePattern, type Params, type Size } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

/**
 * A jittered regular grid, read as a local proximity graph: `dist(i,j) <
 * radius` draws an edge, trimmed to run rim-to-rim between the two dots
 * (not centre-to-centre — see "Edges" below). There is no algebraic theorem
 * forcing order here (no Farris congruence, no divergence-free curl) — the
 * order is compositional. Rows and columns come from a plain lattice, and
 * jitter only perturbs it; it never scrambles it — `jitter` defaults to a
 * tenth of the cell, small enough that rows and columns stay unmistakable
 * at a glance. `radius` sits a little under the cell spacing, so most — not
 * all — points stay unconnected: at defaults roughly 30% of dots carry at
 * least one edge (measured in nodegarden.test.ts), mostly pairs with the
 * occasional 3+-dot chain where the local search catches more than one
 * neighbour. The sparseness is directional, not absolute: it is still MOST
 * dots unconnected, but the connected minority is meant to be plainly
 * visible, not a rare accident. This is what keeps it distinct from
 * `delaunay`, whose global triangulation connects every point by
 * construction — nodegarden's graph stays local and majority-empty (see the
 * "overlap defence" note in the spike report for the param corner where the
 * two converge).
 *
 * Placement — dots never overlap, by construction, not by luck: point
 * (i, j) sits at its lattice position, offset by a seeded jitter draw
 * (`jitter` of the cell, per axis) combined with a phase-driven fbm
 * displacement — the "drift" field, sampled at the plain lattice
 * coordinate. The drift read-point orbits a fixed circle in noise space
 * once per cycle, `(x + ρcos2πph, y + ρsin2πph)` (spec formula, §
 * "nodegarden — proximity graph"): value noise has no period of its own
 * (makeNoise2D hashes absolute lattice cells), so a closed orbit is the
 * only path that returns the noise read to where it started. `ph = phase %
 * 1`, and cos/sin are themselves exactly 1-periodic, so phase 0 and phase 1
 * sample the identical point — the loop closes byte-for-byte with no
 * special-casing. The combined (jitter + drift) offset vector is then
 * clamped in magnitude to `maxDisp` — computed fresh from the current
 * `cell`/`dotSize` so it holds for every param combination, not just the
 * shipped defaults — which guarantees the worst case (two axis-adjacent
 * points displaced straight at each other) still clears both dot radii plus
 * a `MIN_GAP_FRAC` (8%) sliver of `cell` as dark air. This is a hard,
 * tested invariant (see "dots never overlap" in nodegarden.test.ts), not a
 * tuned coincidence — pushing jitter or drift to their param maximums
 * simply saturates the clamp rather than ever producing a touching pair.
 *
 * Edges — rim-to-rim, not centre-to-centre: a line drawn between two dot
 * *centres* spends `2·dotSize` of its length buried under the fills it
 * connects, which at these dot sizes was most of the stroke (a bug an
 * earlier version of this pattern shipped with — see the spike report's
 * revision history). Each endpoint is pulled in along the connecting unit
 * vector by `dotSize`, so the drawn segment is the actual dark-ground gap.
 * If that gap is under `MIN_DRAWABLE_GAP_PX`, no line is drawn at all — at
 * that distance the two dots already read as touching, and a few-pixel
 * stub would only look like a rendering glitch.
 *
 * Edge continuity: `edgeFade` blends between a hard cutoff (opacity pops
 * from 0 to 1 the instant `dist` crosses `radius` — this is the fizz risk:
 * a pair hovering near the boundary under drift flickers on/off every frame
 * it crosses) and a full linear fade starting at `dist = 0`. In between,
 * `fadeStart = radius·(1 − edgeFade)` marks where the ramp begins; opacity
 * is 1 below `fadeStart` and ramps linearly to exactly 0 at `dist = radius`
 * — continuous at the crossing for any `edgeFade > 0`, so raising it (not
 * retuning `radius` or `jitter`) is the fix for chatter. Default `edgeFade`
 * is deliberately low (0.03): the fade band is a thin margin right at the
 * boundary, so a typical connected pair renders at legible opacity — only
 * the pairs about to break (or that just formed) render faint. See
 * `tests/patterns/nodegarden.test.ts` for the measured births/deaths and
 * opacity-jump numbers this claim rests on.
 */

export interface GardenPoint { x: number; y: number; i: number; j: number }
export interface GardenEdge {
  a: number; b: number; dist: number; rimGap: number; opacity: number;
  /** True when this pair is inside `radius` NOW but was not in the pattern's
   *  resting configuration (phase 0) — i.e. the phase orbit carried the two
   *  nodes together. These are the connections that appear while the stage
   *  plays, as opposed to the ones already present in the still design, and
   *  they are the ones drawn heavier. Derived from the current frame alone:
   *  the pattern is a pure function with no frame-to-frame memory, so "new"
   *  has to be a property of the geometry, not of history. */
  born: boolean;
}
export interface Garden { points: GardenPoint[]; edges: GardenEdge[]; cols: number; rows: number; maxDisp: number }

const MARGIN = 24;
/** Noise-space frequency: how many noise cells span the shorter canvas side.
 *  Fixed, not exposed — `drift` controls displacement amplitude; this only
 *  sets the drift field's own texture scale, kept close to fabric's 3.5. */
const NOISE_SPAN = 3.5;
/** Orbit radius in noise-space units for the phase drift read-point (same
 *  role as fabric's R=0.2 / flowfield's R=0.6 — chosen so a full cycle
 *  sweeps a visually meaningful arc of the noise field without the read
 *  point leaving its local neighbourhood entirely). */
const ORBIT_R = 0.5;
/** The orbit read-point at phase 0 — the resting configuration every edge is
 *  compared against to decide whether the animation created it. */
const REST_DX = ORBIT_R;
const REST_DY = 0;
/** The guaranteed floor on rim-to-rim gap between ANY two dots, as a
 *  fraction of `cell`. This is what makes "dots never overlap" a property
 *  of the construction rather than a lucky default — see `maxDisp` below. */
const MIN_GAP_FRAC = 0.08;
/** How much brighter a NEWLY-FORMED edge is than one already in the design. */
const EDGE_VIVID = 1.35;
/** And how much heavier. Applied only to `born` edges — see GardenEdge.born. */
const EDGE_BORN_WIDTH = 1.6;

/** Below this many px of rim-to-rim gap, a line reads as touching dots
 *  anyway — skip drawing the stub rather than paint a few-pixel sliver. */
const MIN_DRAWABLE_GAP_PX = 2;
/** Cap on the neighbour-search half-width (in grid cells), so a pathological
 *  param corner (max radius + max jitter + max drift, min cell) can't blow
 *  up the O(n·W²) edge search. Generous relative to the real params' worst
 *  case (see nodegarden.test.ts's "search window stays correct" check). */
const MAX_SEARCH_W = 10;

/**
 * Pure field computation, independent of rendering — exported so tests can
 * sample the graph directly across seeds/phases without re-parsing SVG.
 * `ph` is expected pre-wrapped to [0, 1); `generate` below does that once.
 */
export function computeGarden(p: Params, seed: number, size: Size, ph: number): Garden {
  const cell = p['cell']!;
  const jitter = p['jitter']!;
  const radius = p['radius']!;
  const drift = p['drift']!;
  const dotSize = p['dotSize']!;
  const edgeFade = p['edgeFade']!;

  const cols = Math.max(1, Math.floor((size.w - 2 * MARGIN) / cell) + 1);
  const rows = Math.max(1, Math.floor((size.h - 2 * MARGIN) / cell) + 1);
  const gw = (cols - 1) * cell, gh = (rows - 1) * cell;
  const ox = (size.w - gw) / 2, oy = (size.h - gh) / 2;

  // The overlap guarantee: two axis-adjacent lattice points start `cell`
  // apart. If each can move at most `maxDisp` from its own lattice slot, the
  // worst case (both displaced straight at each other) closes the gap by
  // 2·maxDisp, so the true minimum centre distance is cell − 2·maxDisp. For
  // that to still clear two dot radii plus the guaranteed air gap
  // (2·dotSize + MIN_GAP_FRAC·cell), maxDisp can be at most half of what's
  // left over — this is a hard cap applied below to jitter+drift combined
  // (as a vector magnitude, not per-axis), independent of how high either
  // param is dialled. Floors at 0: a param corner that asks for dots bigger
  // than the lattice can hold (2·dotSize alone exceeding cell − the gap)
  // degrades to a rigid, ungapped lattice rather than a false guarantee —
  // reported, not silently fixed (see nodegarden.test.ts).
  const minGapAbs = MIN_GAP_FRAC * cell;
  const maxDisp = Math.max(0, (cell - 2 * dotSize - minGapAbs) / 2);

  // Two independent seed streams: jitter placement (a PRNG draw per point,
  // order-stable so seed changes are visible even at defaults) and the drift
  // field's own texture (two fbm layers so x/y displacement don't share a
  // shape and the drift reads as a genuine 2D flow, not a 1D wobble). Both
  // read at the plain lattice position — decoupled from each other so the
  // combined-vector clamp below is the only place they interact.
  const rnd = mulberry32(deriveSeed(seed, 'nodegarden-jitter'));
  const noiseX = fbm2D(deriveSeed(seed, 'nodegarden-driftX'), 2);
  const noiseY = fbm2D(deriveSeed(seed, 'nodegarden-driftY'), 2);
  const freq = NOISE_SPAN / Math.min(size.w, size.h);
  const dxOrbit = ORBIT_R * Math.cos(2 * Math.PI * ph);
  const dyOrbit = ORBIT_R * Math.sin(2 * Math.PI * ph);

  const points: GardenPoint[] = new Array(cols * rows);
  // Jitter is kept per point so the phase-0 reference position can be
  // resolved lazily: only edge endpoints ever consult it, so computing it
  // for every lattice point doubled the noise cost for nothing.
  const jitX = new Float64Array(cols * rows);
  const jitY = new Float64Array(cols * rows);
  const restCache: (GardenPoint | undefined)[] = new Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const gx = ox + i * cell, gy = oy + j * cell;
      const jx = (rnd() * 2 - 1) * (jitter * cell);
      const jy = (rnd() * 2 - 1) * (jitter * cell);
      const nx = noiseX(gx * freq + dxOrbit, gy * freq + dyOrbit);
      const ny = noiseY(gx * freq + dxOrbit, gy * freq + dyOrbit);
      let dx = jx + drift * nx, dy = jy + drift * ny;
      const mag = Math.hypot(dx, dy);
      if (mag > maxDisp) {
        const scale = maxDisp / (mag || 1);
        dx *= scale; dy *= scale;
      }
      points[j * cols + i] = { x: gx + dx, y: gy + dy, i, j };
      jitX[j * cols + i] = jx;
      jitY[j * cols + i] = jy;
    }
  }

  // Local neighbour search only: bound how far apart in grid index two
  // points can be while still possibly landing within `radius` of each
  // other. Each point's displacement from its lattice slot is now bounded
  // by `maxDisp` (not the raw jitter/drift magnitudes), so by the triangle
  // inequality two points' true grid distance can differ from their drawn
  // distance by at most 2·maxDisp — hence the `reach` below, converted to a
  // cell count and capped for safety.
  const reach = radius + 2 * maxDisp;
  const W = Math.min(MAX_SEARCH_W, Math.max(1, Math.ceil(reach / cell)));

  // The same node at phase 0 — same jitter, same drift amplitude, only the
  // orbit removed — so a comparison isolates what the phase motion did
  // rather than what the audio did to `drift`. Memoised per point.
  const restOf = (idx: number): GardenPoint => {
    const hit = restCache[idx];
    if (hit) return hit;
    const pi = idx % cols, pj = (idx - pi) / cols;
    const gx = ox + pi * cell, gy = oy + pj * cell;
    const rnx = noiseX(gx * freq + REST_DX, gy * freq + REST_DY);
    const rny = noiseY(gx * freq + REST_DX, gy * freq + REST_DY);
    let rdx = jitX[idx]! + drift * rnx, rdy = jitY[idx]! + drift * rny;
    const rmag = Math.hypot(rdx, rdy);
    if (rmag > maxDisp) {
      const rs = maxDisp / (rmag || 1);
      rdx *= rs; rdy *= rs;
    }
    const r = { x: gx + rdx, y: gy + rdy, i: pi, j: pj };
    restCache[idx] = r;
    return r;
  };

  const edges: GardenEdge[] = [];
  const fadeStart = radius * (1 - edgeFade);
  const fadeSpan = Math.max(1e-6, radius - fadeStart);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * cols + i;
      const pa = points[a]!;
      for (let dj = 0; dj <= W; dj++) {
        const diStart = dj === 0 ? 1 : -W;
        for (let di = diStart; di <= W; di++) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || ni >= cols || nj < 0 || nj >= rows) continue;
          const b = nj * cols + ni;
          const pb = points[b]!;
          const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (dist >= radius) continue;
          const opacity = dist <= fadeStart ? 1 : 1 - (dist - fadeStart) / fadeSpan;
          const ra = restOf(a), rb = restOf(b);
          const born = Math.hypot(rb.x - ra.x, rb.y - ra.y) >= radius;
          edges.push({ a, b, dist, rimGap: dist - 2 * dotSize, opacity, born });
        }
      }
    }
  }

  return { points, edges, cols, rows, maxDisp };
}

export const nodegarden = definePattern({
  id: 'nodegarden',
  family: 'points',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: {
    continuous: ['jitter', 'radius', 'drift', 'dotSize', 'edgeFade', 'strokeWidth', 'opacity', 'size'],
    usesPhase: true,
  },
  params: [
    { key: 'cell', kind: 'int', min: 24, max: 100, step: 2, default: 72, label: 'nodegarden.cell' },
    { key: 'jitter', kind: 'float', min: 0, max: 0.5, step: 0.01, default: 0.1, label: 'nodegarden.jitter' },
    { key: 'radius', kind: 'float', min: 4, max: 130, step: 0.5, default: 64.5, label: 'nodegarden.radius' },
    { key: 'drift', kind: 'float', min: 0, max: 30, step: 1, default: 8, label: 'nodegarden.drift' },
    { key: 'dotSize', kind: 'float', min: 2, max: 32, step: 0.5, default: 24, label: 'nodegarden.dotSize' },
    { key: 'edgeFade', kind: 'float', min: 0, max: 1, step: 0.05, default: 0.03, label: 'nodegarden.edgeFade' },
    // Range and default both raised: at 1.1 against 24px dots the edges were
    // hairlines between fat circles, and the old 2.5 ceiling could not make
    // them read as the event they are. 3.0 is a visible thread at the default
    // dot size; the 6 ceiling lets an edge become a bar. Floor stays 0.1 for
    // anyone who wants the graph implied rather than drawn.
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 6, step: 0.05, default: 3, label: 'nodegarden.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.85, label: 'nodegarden.opacity' },
  ],
  generate(p, seed, size) {
    const ph = (p['phase'] ?? 0) % 1;
    const { points, edges } = computeGarden(p, seed, size, ph);
    const strokeWidth = p['strokeWidth']!;
    const baseOpacity = p['opacity']!;
    const dotR = p['dotSize']!;

    const children: SvgNode[] = [];
    // Edges under dots, so the large dots (the actual composition) read on top.
    for (const e of edges) {
      // Only the connections the animation created are lifted: an edge already
      // present in the resting design keeps exactly the weight and brightness
      // it always had, so the still is unchanged. The ramp near the boundary
      // still runs to zero either way, so a born edge fades in rather than
      // popping.
      const vivid = e.born ? EDGE_VIVID : 1;
      const op = Math.round(Math.min(1, e.opacity * baseOpacity * vivid) * 1000) / 1000;
      const sw = Math.round(strokeWidth * (e.born ? EDGE_BORN_WIDTH : 1) * 100) / 100;
      if (op < 0.01) continue; // faded past visibility — skip, not just invisible
      if (e.rimGap < MIN_DRAWABLE_GAP_PX) continue; // reads as touching anyway
      const pa = points[e.a]!, pb = points[e.b]!;
      // Rim-to-rim, not centre-to-centre — see the "Edges" note up top.
      const ux = (pb.x - pa.x) / e.dist, uy = (pb.y - pa.y) / e.dist;
      const x1 = pa.x + ux * dotR, y1 = pa.y + uy * dotR;
      const x2 = pb.x - ux * dotR, y2 = pb.y - uy * dotR;
      children.push(el('line', {
        x1, y1, x2, y2,
        // Same `ink` as the dots — the edges are the same material, not a
        // second colour. Their prominence comes from weight and brightness
        // instead: see EDGE_VIVID below.
        stroke: 'ink',
        'stroke-width': sw,
        'stroke-linecap': 'round',
        opacity: op,
      }));
    }
    for (const pt of points) {
      children.push(el('circle', { cx: pt.x, cy: pt.y, r: dotR, fill: 'ink', opacity: baseOpacity }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
