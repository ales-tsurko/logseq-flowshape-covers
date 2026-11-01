import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

/**
 * Iso Weave — a strictly periodic isometric interlock.
 *
 * One motif (square-section beams meeting at a cube corner) is tiled
 * edge-to-edge on a triangular lattice, and a per-unit depth stagger along
 * the (1,1,1) body diagonal makes neighbouring units' arms pass genuinely in
 * front of and behind one another. There is no randomness anywhere: the
 * pattern is a function of its params alone (hence `usesSeed: false`), and
 * this file deliberately imports no PRNG.
 */

type Vec2 = [number, number];
type Vec3 = [number, number, number];

/** An axis-aligned lattice box: minimum corner plus per-axis extent. */
export interface Box {
  min: Vec3;
  size: Vec3;
  /** Painter key: depth (i+j+k) of the box centre. */
  depth: number;
}

/** Guard against a pathological unit count (cf. apollonian's MAX_CIRCLES). */
const MAX_UNITS = 900;

const f2 = (n: number): string => n.toFixed(2);

const pointsAttr = (pts: Vec2[]): string => pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ');

/** Build one box from a min corner and a size, caching its centre depth. */
function box(min: Vec3, size: Vec3): Box {
  return {
    min,
    size,
    depth: min[0] + size[0] / 2 + min[1] + size[1] / 2 + min[2] + size[2] / 2,
  };
}

/**
 * The boxes of one unit placed at lattice origin `o`.
 *
 * `unit` selects the motif, `rot` cyclically rotates the axis triple (used by
 * elbow/chevron to produce a herringbone / zigzag), `w` is the beam's square
 * section and `len` the (already clamped) arm length.
 *
 * Every box lies inside [-w/2, w/2+len] on each axis for tripod/elbow, and
 * inside [-(len+w/2), len+w/2] on the beam axis for chevron — see the
 * interpenetration note in `generate`.
 */
function unitBoxes(unit: number, o: Vec3, rot: number, w: number, len: number): Box[] {
  const h = w / 2;
  const corner = box([o[0] - h, o[1] - h, o[2] - h], [w, w, w]);
  const boxes: Box[] = [corner];

  /** An arm of length `len` leaving the corner along ±axis. */
  const arm = (axis: number, dir: 1 | -1): Box => {
    const min: Vec3 = [o[0] - h, o[1] - h, o[2] - h];
    const size: Vec3 = [w, w, w];
    const base = o[axis]!;
    min[axis] = dir === 1 ? base + h : base - h - len;
    size[axis] = len;
    return box(min, size);
  };

  if (unit === 0) {
    // tripod: +i, +j, +k out of a shared corner cube.
    boxes.push(arm(0, 1), arm(1, 1), arm(2, 1));
  } else if (unit === 1) {
    // elbow: two arms, axis triple rotated per unit → herringbone.
    boxes.push(arm(rot % 3, 1), arm((rot + 1) % 3, 1));
  } else {
    // chevron: two collinear arms split by the corner collar. The collar's
    // faces read as the joint between the two halves (a butt joint, not the
    // mitre the design sketch called for: a mitre is only meaningful for
    // beams meeting at an angle, and collinear arms have none).
    boxes.push(arm(rot % 3, 1), arm(rot % 3, -1));
  }
  return boxes;
}

/**
 * The longest arm that keeps every unit's solid disjoint from every other's,
 * for this `stagger` and unit type. See the long note in `generate` for the
 * derivation; tests/patterns/isoweave.test.ts checks it exhaustively.
 */
export function clampArm(armLength: number, beamWidth: number, stagger: number, unit: number): number {
  // A tripod/elbow spans L+w on every axis; the closest same-depth-class
  // neighbour is 1 lattice unit away at stagger 1-2 and 2 units at stagger 3+.
  let len = Math.min(armLength, (stagger >= 3 ? 2 : 1) - beamWidth);
  // Chevron's two arms are collinear, so the unit spans 2L+w along its beam
  // axis. Offsets that leave the other two axes at zero (and so are not
  // separated by the w-wide cross-section) exist at a distance of 3 lattice
  // units for even staggers only; cap 2L+w there. It binds at stagger 4,
  // where the tripod bound of 2-w would otherwise let arms interpenetrate.
  if (unit === 2 && stagger % 2 === 0) len = Math.min(len, (3 - beamWidth) / 2);
  return len;
}

/**
 * The boxes of the unit at screen-lattice coordinates (a, b) = (m+n, m-n).
 * Exported so the geometry tests can interrogate the same solids the renderer
 * draws rather than a re-derivation of them.
 */
export function unitAt(
  unit: number, a: number, b: number, stagger: number, w: number, len: number,
): Box[] {
  const m = (a + b) / 2;
  const n = (a - b) / 2;
  // (1,1,1) is the unique lattice direction with zero screen displacement, so
  // this shift reorders occlusion without moving a single pixel.
  const delta = ((a % stagger) + stagger) % stagger;
  const o: Vec3 = [m + delta, n - m + delta, delta - n];
  return unitBoxes(unit, o, ((a % 3) + 3) % 3, w, len);
}

export const isoweave = definePattern({
  id: 'isoweave',
  family: 'isometric',
  phase: 1,
  heavy: false,
  // Strictly periodic by construction: no PRNG is consulted, so the seed
  // control would be a lie. Randomize varies the params instead.
  usesSeed: false,
  anim: { continuous: ['armLength', 'beamWidth', 'strokeWidth', 'size'] },
  params: [
    { key: 'cell', kind: 'int', min: 18, max: 70, step: 1, default: 30, label: 'isoweave.cell' },
    {
      key: 'unit', kind: 'enum', min: 0, max: 2, step: 1, default: 0, label: 'isoweave.unit',
      options: ['isoweave.tripod', 'isoweave.elbow', 'isoweave.chevron'],
    },
    { key: 'armLength', kind: 'float', min: 0.5, max: 1.6, step: 0.01, default: 1.0, label: 'isoweave.armLength' },
    { key: 'beamWidth', kind: 'float', min: 0.15, max: 0.7, step: 0.01, default: 0.36, label: 'isoweave.beamWidth' },
    { key: 'stagger', kind: 'int', min: 1, max: 4, step: 1, default: 3, label: 'isoweave.stagger' },
    {
      key: 'render', kind: 'enum', min: 0, max: 2, step: 1, default: 0, label: 'isoweave.render',
      options: ['isoweave.solid', 'isoweave.outline', 'isoweave.hatch'],
    },
    { key: 'hatchDensity', kind: 'float', min: 1, max: 9, step: 0.1, default: 4.0, label: 'isoweave.hatchDensity', dependsOn: { key: 'render', values: [2] } },
    // Min is 0.15, not 0: Randomize picks param minima, and at 0 the solid
    // mode collapses to a single ink tone with no cube reading at all.
    { key: 'faceShading', kind: 'float', min: 0.15, max: 1, step: 0.01, default: 0.78, label: 'isoweave.faceShading', dependsOn: { key: 'render', values: [0, 2] } },
    { key: 'strokeWidth', kind: 'float', min: 0, max: 1.5, step: 0.05, default: 0.5, label: 'isoweave.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const cell = p['cell']!;
    const unit = p['unit']!;
    const armLength = p['armLength']!;
    const beamWidth = p['beamWidth']!;
    const stagger = p['stagger']!;
    const render = p['render']!;
    const hatchDensity = p['hatchDensity']!;
    const faceShading = p['faceShading']!;
    const strokeWidth = p['strokeWidth']!;

    // --- Depth colouring, and the arm-length clamp it buys -----------------
    //
    // Unit origins sit at O(m,n) = m·A + n·B + δ(m,n)·(1,1,1) with
    // A = (1,-1,0) and B = (0,1,-1), so every origin is an INTEGER lattice
    // point and any two units differ by an integer vector t ≠ 0. A tripod or
    // elbow occupies [-w/2, w/2+L] on each axis — an interval of width L+w —
    // so the two units' solids are disjoint as soon as |t_c| ≥ L+w on some
    // axis c. Write span(t) = max_c |t_c|; the arms may reach up to
    // L + w ≤ min over the offsets t that actually occur of span(t).
    //
    // Which offsets occur depends entirely on the colouring, and this is
    // where the design sketch's δ = (m-n) mod stagger has to go. (m-n) is
    // INVARIANT along A+B = (1,0,-1) — the pure horizontal screen step — so
    // every horizontal neighbour pair shares a depth class no matter what
    // `stagger` is, and span((1,0,-1)) = 1 pins L + w ≤ 1 for every stagger.
    // At L + w = 1 nothing anywhere overlaps in screen space (each unit's
    // arms merely butt against its neighbours'), so the stagger reduces to a
    // permutation of the paint order over faces that never overlap: the
    // renders at stagger 1 and 3 come out with a byte-identical *set* of
    // polygons and differ only in their order. Verified before changing it.
    //
    // δ = (m+n) mod stagger instead changes the class across all three
    // nearest-neighbour steps (A: +1, B: +1, A+B: +2) whenever stagger ≥ 3,
    // which lifts the closest same-class offset to span 2 and lets the arms
    // reach a full lattice unit PAST each crossing — a genuine over/under
    // weave. Three is the floor here, not a preference: the unit centres form
    // a triangular lattice, whose chromatic number is 3, so with only two
    // levels some nearest-neighbour pair always shares one. stagger 1 and 2
    // therefore both render the coplanar flat interlock (the design's stated
    // stagger-1 behaviour); stagger 3 and 4 weave, with different
    // interleavings.
    //
    // Chevron needs one extra bound of its own (see `clampArm`). Both claims
    // — no interpenetration, and no painter inversion from the centre-depth
    // sort below — are checked exhaustively over the param space by
    // tests/patterns/isoweave.test.ts.
    //
    // (The design sketch's suspected √3/2 bound is the *screen* neighbour
    // distance, not the lattice one, and is not the constraint.)
    const len = clampArm(armLength, beamWidth, stagger, unit);

    // --- Isometric projection (identical to voxel.ts) ----------------------
    const W = (Math.sqrt(3) / 2) * cell;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const proj = (i: number, j: number, k: number): Vec2 => [
      cx + (i - k) * W,
      cy + ((i + k) / 2 - j) * cell,
    ];
    // Screen images of the three lattice axes.
    const eI: Vec2 = [W, cell / 2];
    const eJ: Vec2 = [0, -cell];
    const eK: Vec2 = [-W, cell / 2];

    // --- Lattice enumeration ----------------------------------------------
    // With a = m+n and b = m-n, O(m,n) projects to (a·W, 1.5·b·cell) about the
    // frame centre; a and b share parity. δ = a mod stagger, and the elbow /
    // chevron axis rotation is a mod 3. The margin is 2·cell, which is exactly
    // the furthest an arm reaches from its own origin (L + w ≤ 2 cells).
    const margin = 2 * cell;
    const aMax = Math.floor((size.w / 2 + margin) / W);
    const bMax = Math.floor((size.h / 2 + margin) / (1.5 * cell));

    const boxes: Box[] = [];
    let units = 0;
    outer:
    for (let b = -bMax; b <= bMax; b++) {
      for (let a = -aMax; a <= aMax; a++) {
        if (((a + b) & 1) !== 0) continue;
        if (units >= MAX_UNITS) break outer;
        units++;
        for (const bx of unitAt(unit, a, b, stagger, beamWidth, len)) boxes.push(bx);
      }
    }

    if (boxes.length === 0) return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, []);

    // --- Painter's algorithm ----------------------------------------------
    // Sort back to front by centre depth (i+j+k). Voxel accepts this as an
    // approximation; here it is exact, and that is a load-bearing claim
    // because units at adjacent δ do share screen space. Two boxes project
    // onto overlapping areas exactly when the line R·(1,1,1) meets the
    // interior of their Minkowski difference, and the sign of that
    // intersection says which is genuinely in front; the geometry test walks
    // every box pair over the whole param space and confirms centre depth
    // always agrees with it, with no ties among pairs that overlap. The index
    // tie-break just pins a single deterministic order for the rest.
    const order = boxes.map((_, idx) => idx);
    order.sort((x, y) => boxes[x]!.depth - boxes[y]!.depth || x - y);

    // The ink stroke IS the drawing in outline/hatch mode, so it gets a floor
    // that the paper hairlines of solid mode do not need (strokeWidth = 0 is a
    // legitimate "no gaps" setting there, but would render a blank page here).
    const lineW = render === 0 ? strokeWidth : Math.max(strokeWidth, 0.2);
    // Never let hatching collapse to solid ink at high density / small cell.
    const minSpacing = Math.max(2 * lineW, 0.6);

    interface Face { p0: Vec2; e1: Vec2; e2: Vec2; tone: number }

    const children: SvgNode[] = [];
    for (const idx of order) {
      const { min, size: s } = boxes[idx]!;
      const [i0, j0, k0] = min;
      const [si, sj, sk] = s;
      // Only the +j, +i and +k faces face the (1,1,1) viewer.
      const faces: Face[] = [
        {
          p0: proj(i0, j0 + sj, k0),
          e1: [eI[0] * si, eI[1] * si],
          e2: [eK[0] * sk, eK[1] * sk],
          tone: 1,
        },
        {
          p0: proj(i0, j0, k0 + sk),
          e1: [eI[0] * si, eI[1] * si],
          e2: [eJ[0] * sj, eJ[1] * sj],
          tone: 1 - 0.45 * faceShading,
        },
        {
          p0: proj(i0 + si, j0, k0),
          e1: [eJ[0] * sj, eJ[1] * sj],
          e2: [eK[0] * sk, eK[1] * sk],
          tone: 1 - 0.75 * faceShading,
        },
      ];

      for (const face of faces) {
        const { p0, e1, e2, tone } = face;
        const pts: Vec2[] = [
          p0,
          [p0[0] + e1[0], p0[1] + e1[1]],
          [p0[0] + e1[0] + e2[0], p0[1] + e1[1] + e2[1]],
          [p0[0] + e2[0], p0[1] + e2[1]],
        ];
        const points = pointsAttr(pts);

        if (render === 0) {
          children.push(el('polygon', {
            points,
            fill: 'ink',
            'fill-opacity': tone,
            stroke: 'paper',
            'stroke-width': strokeWidth,
            'stroke-linejoin': 'round',
          }));
          continue;
        }

        // outline and hatch share the paper-filled, ink-outlined face. That
        // paper fill IS the hidden-line removal: a nearer box simply paints
        // over whatever sits behind it.
        children.push(el('polygon', {
          points,
          fill: 'paper',
          stroke: 'ink',
          'stroke-width': lineW,
          'stroke-linejoin': 'round',
        }));
        if (render !== 2) continue;

        // Hatch the face in its own parameter space: P0 + a·e1 + b·e2 with
        // a, b in [0,1]. Lines are b = const running a: 0 → 1, so they are
        // exactly inside the parallelogram — no clipping needed anywhere.
        // Darker faces (higher tone) hatch denser.
        const len2 = Math.hypot(e2[0], e2[1]);
        const spacing = Math.max(cell / (hatchDensity * Math.max(tone, 1e-6)), minSpacing);
        const nLines = Math.max(1, Math.floor(len2 / spacing));
        let d = '';
        for (let t = 0; t < nLines; t++) {
          const bb = (t + 0.5) / nLines;
          const sx = p0[0] + e2[0] * bb;
          const sy = p0[1] + e2[1] * bb;
          d += `M${f2(sx)} ${f2(sy)}L${f2(sx + e1[0])} ${f2(sy + e1[1])}`;
        }
        children.push(el('path', {
          d,
          fill: 'none',
          stroke: 'ink',
          'stroke-width': lineW,
          'stroke-linecap': 'round',
        }));
      }
    }

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
