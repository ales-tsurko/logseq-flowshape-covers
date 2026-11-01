import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

/** A kept lattice cell, plus the tie-break jitter drawn for it during scattering.
 *  `base` records membership of the phase-0 cull (which is what the frame fit
 *  and the depth normalisation are pinned to, so neither breathes as the
 *  dissolution wave passes); `draw` is membership of this frame's cull. They
 *  are equal at phase 0 by construction. */
interface Cell {
  i: number;
  j: number;
  k: number;
  jitter: number;
  base: boolean;
  draw: boolean;
}

const TAU = Math.PI * 2;

/** Two unit vectors spanning the plane perpendicular to the view axis
 *  (1,1,1): u = (1,-1,0)/√2 and v = n × u ∝ (1,1,-2)/√6. The lighting axis
 *  precesses around (1,1,1) in this plane. */
const LU: [number, number, number] = [Math.SQRT1_2, -Math.SQRT1_2, 0];
const LV: [number, number, number] = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];

type Vec2 = [number, number];

const round2 = (n: number): number => Math.round(n * 100) / 100;

function centroid(pts: Vec2[]): Vec2 {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  return [cx / pts.length, cy / pts.length];
}

/** Shrink a face polygon toward its own centroid by factor f = 1 - gap. */
function shrink(pts: Vec2[], f: number): Vec2[] {
  const [cx, cy] = centroid(pts);
  return pts.map(([x, y]): Vec2 => [cx + (x - cx) * f, cy + (y - cy) * f]);
}

function pointsAttr(pts: Vec2[]): string {
  return pts.map(([x, y]) => `${round2(x)},${round2(y)}`).join(' ');
}

export const voxel = definePattern({
  id: 'voxel',
  family: 'isometric',
  phase: 1,
  heavy: false,
  // A voxel form's seed drives the scatter cull (and a depth tie-break
  // jitter that is provably invisible — see step 6 below): with scatter
  // above 0, different seeds cull different cells and the silhouette
  // genuinely changes shape. scatter's default (0.35, see the param below)
  // keeps that cull live out of the box, so Randomize visibly reshapes the
  // form and a seed carried in a shared URL (e.g. a curated preset) means
  // what it says.
  usesSeed: true,
  anim: { continuous: ['gap', 'scatter', 'faceShading', 'depthShading', 'size'], usesPhase: true },
  params: [
    { key: 'shape', kind: 'enum', min: 0, max: 2, step: 1, default: 1, label: 'voxel.shape', options: ['voxel.sphere', 'voxel.cube', 'voxel.torus'] },
    { key: 'dimension', kind: 'int', min: 4, max: 18, step: 1, default: 12, label: 'voxel.dimension' },
    { key: 'gap', kind: 'float', min: 0, max: 0.4, step: 0.01, default: 0.08, label: 'voxel.gap' },
    { key: 'shellOnly', kind: 'bool', min: 0, max: 1, step: 1, default: 1, label: 'voxel.shellOnly' },
    // Non-zero by default so the seed-driven scatter cull is live at
    // defaults (see `usesSeed` above): at scatter=0 the seed only reaches
    // the visually-inert tie-break jitter (step 6) and Randomize does
    // nothing. 0.35 removes roughly a third of shell cells — enough to
    // visibly vary the silhouette between seeds without eroding the form
    // past recognition.
    { key: 'scatter', kind: 'float', min: 0, max: 0.6, step: 0.01, default: 0.35, label: 'voxel.scatter' },
    { key: 'faceShading', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.75, label: 'voxel.faceShading' },
    { key: 'depthShading', kind: 'float', min: 0, max: 0.9, step: 0.01, default: 0.55, label: 'voxel.depthShading' },
    { key: 'strokeWidth', kind: 'float', min: 0, max: 1.2, step: 0.05, default: 0.5, label: 'voxel.strokeWidth' },
  ],
  generate(p, seed, size) {
    const rnd = mulberry32(deriveSeed(seed, 'voxel'));
    const shape = p['shape']!;
    const dimension = p['dimension']!;
    const gap = p['gap']!;
    const shellOnly = p['shellOnly']! >= 0.5;
    const scatter = p['scatter']!;
    const faceShading = p['faceShading']!;
    const depthShading = p['depthShading']!;
    const strokeWidth = p['strokeWidth']!;

    // Two intrinsic motions, deliberately of different kinds.
    //
    // (a) The lighting axis precesses. Shading currently reads depth along
    //     the view axis (1,1,1); tilting that axis off (1,1,1) and walking
    //     the tilt round a circle once per cycle sweeps light across the
    //     solid, and because the *sort* axis stays (1,1,1) not one polygon
    //     moves and not one z-order changes. This is a reparametrisation
    //     rather than a perturbation, so it never stalls: even at phase 0 it
    //     is passing through, not resting.
    // (b) A travelling wave of dissolution. Cells whose scatter draw sits
    //     near the threshold wink out and back as the band crosses, so the
    //     form's holes migrate through it in swells. Discrete decision on a
    //     continuous input, so fizz is the risk: the wave is a single
    //     sinusoid in phase for every cell, which caps each cell at one
    //     disappearance and one return per 20 s cycle — measured, and it
    //     holds — so this is sparse popping, never chatter. *Which* cells go
    //     is still scattered (it is whichever ones sat nearest the scatter
    //     threshold), but the band that releases them is a plane in screen
    //     height, so the popping travels through the solid as a stratum
    //     instead of firing everywhere at once. Deliberately small: about
    //     7% of the cell count over the cycle, an ornament on (a) and not a
    //     competing event.
    //
    // Both are exactly 0 at phase 0 (cos(0) - 1 and sin(0) are exactly 0),
    // and `% 1` makes phase 1 the literal phase-0 expression.
    const ph = (p['phase'] ?? 0) % 1;
    const wobbleC = Math.cos(TAU * ph) - 1;
    const wobbleS = Math.sin(TAU * ph);
    const TILT = 0.5;
    const lightX = 1 + TILT * (wobbleC * LU[0] + wobbleS * LV[0]);
    const lightY = 1 + TILT * (wobbleC * LU[1] + wobbleS * LV[1]);
    const lightZ = 1 + TILT * (wobbleC * LU[2] + wobbleS * LV[2]);

    const D = Math.floor(dimension / 2);
    const D2 = D * D;
    const R = D * 0.62;
    const rr = D * 0.3;

    // Screen height of a cell in projection units is (i+k)/2 - j; over the
    // lattice that spans 4D, so this is one wavelength up the form. The
    // `- cos(TAU*sp)` term is what pins the wave to 0 at phase 0 for every
    // cell at once (no travelling wave can vanish identically at one phase
    // without a companion term); its cost is that the swell breathes over
    // the cycle rather than sliding at constant amplitude, which is why (a)
    // above carries the continuous motion and this only ornaments it.
    const SWELL = 0.09;
    const swell = (i: number, j: number, k: number): number => {
      if (ph === 0) return 0;
      const sp = ((i + k) * 0.5 - j) / (4 * D);
      return SWELL * (Math.cos(TAU * (ph - sp)) - Math.cos(TAU * sp));
    };

    const inShape = (i: number, j: number, k: number): boolean => {
      if (shape === 0) return i * i + j * j + k * k <= D2;
      if (shape === 1) return true;
      const d = Math.hypot(i, k) - R;
      return d * d + j * j <= rr * rr;
    };

    // 1. Base lattice, per the chosen bounding shape.
    const baseKeys = new Set<string>();
    const base: [number, number, number][] = [];
    for (let i = -D; i <= D; i++) {
      for (let j = -D; j <= D; j++) {
        for (let k = -D; k <= D; k++) {
          if (inShape(i, j, k)) {
            base.push([i, j, k]);
            baseKeys.add(`${i},${j},${k}`);
          }
        }
      }
    }

    const isShellCell = ([i, j, k]: [number, number, number]): boolean => {
      const full =
        baseKeys.has(`${i + 1},${j},${k}`) && baseKeys.has(`${i - 1},${j},${k}`) &&
        baseKeys.has(`${i},${j + 1},${k}`) && baseKeys.has(`${i},${j - 1},${k}`) &&
        baseKeys.has(`${i},${j},${k + 1}`) && baseKeys.has(`${i},${j},${k - 1}`);
      return !full;
    };

    // 2. One PRNG stream, drawn in deterministic (i,j,k) order over the FULL base
    //    lattice (not the shellOnly-filtered subset): every cell's random draw then
    //    depends only on its own coordinates, never on how many other cells happened
    //    to survive shellOnly. That draw doubles as a depth tie-break jitter (see step
    //    5), and keeping it population-independent is required for correctness: two
    //    shell cells can share both a screen-space edge and a depth key (i+j+k), so if
    //    their jitter values shifted depending on whether interior cells were also in
    //    the stream, shellOnly on vs off could pick a different winner at that shared
    //    edge and the two would no longer render identically for a solid form.
    const ordered = [...base].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    // The union of the phase-0 cull and this frame's cull, in the same order
    // the single stream produced them. At phase 0 the two culls coincide and
    // this is exactly the old `cells`, member for member.
    const cells: Cell[] = [];
    for (const [i, j, k] of ordered) {
      const r = rnd();
      if (shellOnly && !isShellCell([i, j, k])) continue;
      const inBase = !(r < scatter);
      const inDraw = !(r < scatter + swell(i, j, k));
      if (!inBase && !inDraw) continue;
      cells.push({ i, j, k, jitter: r, base: inBase, draw: inDraw });
    }

    if (cells.length === 0) {
      return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, []);
    }

    // Everything that would otherwise breathe with the dissolution wave — the
    // frame fit and the shading normalisation — is measured on the phase-0
    // cull, so the form holds still while its holes travel. (The fallback
    // covers the degenerate case where the phase-0 cull took everything.)
    const anchored = cells.some((c) => c.base) ? (c: Cell): boolean => c.base : (): boolean => true;

    // Lighting range actually present in this form, for shading normalisation.
    let depthMin = Infinity, depthMax = -Infinity;
    for (const c of cells) {
      if (!anchored(c)) continue;
      const depth = c.i * lightX + c.j * lightY + c.k * lightZ;
      if (depth < depthMin) depthMin = depth;
      if (depth > depthMax) depthMax = depth;
    }
    const depthSpan = Math.max(depthMax - depthMin, 1e-6);

    // 4. Isometric projection at unit cube edge (s = 1); fit-to-frame scale applied after.
    const s = 1;
    const w = (s * Math.sqrt(3)) / 2;
    const h = s / 2;
    const v = s;
    const f = 1 - gap;

    interface Face { pts: Vec2[]; fillOpacity: number }
    interface Built { cell: Cell; faces: Face[] }

    const built: Built[] = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const cell of cells) {
      const { i, j, k } = cell;
      const px = (i - k) * w;
      const py = (i + k) * h - j * v;
      const depth = i * lightX + j * lightY + k * lightZ;
      const dn = (depth - depthMin) / depthSpan;
      const depthFactor = 1 - depthShading * (1 - dn);
      const shaded = (orientationOpacity: number): number => Math.max(0.06, orientationOpacity * depthFactor);
      const top: Vec2[] = [[0, 0], [w, h], [0, 2 * h], [-w, h]];
      const left: Vec2[] = [[-w, h], [0, 2 * h], [0, 2 * h + v], [-w, h + v]];
      const right: Vec2[] = [[w, h], [0, 2 * h], [0, 2 * h + v], [w, h + v]];
      const faces: Face[] = [
        { pts: shrink(top, f).map(([x, y]): Vec2 => [px + x, py + y]), fillOpacity: shaded(1) },
        { pts: shrink(left, f).map(([x, y]): Vec2 => [px + x, py + y]), fillOpacity: shaded(1 - 0.45 * faceShading) },
        { pts: shrink(right, f).map(([x, y]): Vec2 => [px + x, py + y]), fillOpacity: shaded(1 - 0.75 * faceShading) },
      ];
      if (anchored(cell)) {
        for (const face of faces) {
          for (const [x, y] of face.pts) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (cell.draw) built.push({ cell, faces });
    }

    // 5. Fit the projected form inside the frame.
    const bw = Math.max(maxX - minX, 1e-6);
    const bh = Math.max(maxY - minY, 1e-6);
    const scale = (0.86 * Math.min(size.w, size.h)) / Math.max(bw, bh);
    const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
    const fcx = size.w / 2, fcy = size.h / 2;
    const project = ([x, y]: Vec2): Vec2 => [(x - bcx) * scale + fcx, (y - bcy) * scale + fcy];

    // 6. Painter's algorithm: draw nearer cubes last. Depth axis is i+j+k (verified
    //    empirically — the only candidate under which a shellOnly=1 render is
    //    pixel-identical to the shellOnly=0 solid render). A cell's jitter breaks ties
    //    among cells sharing a depth value; those cells never share screen space (the
    //    (1,1,1) diagonal is the sole direction with zero screen displacement, and
    //    stepping along it changes i+j+k by 3), so the tie-break is visually inert but
    //    keeps output seed-dependent.
    built.sort((a, b) => {
      const da = a.cell.i + a.cell.j + a.cell.k + a.cell.jitter * 1e-6;
      const db = b.cell.i + b.cell.j + b.cell.k + b.cell.jitter * 1e-6;
      return da - db;
    });

    const children: SvgNode[] = [];
    for (const { faces } of built) {
      for (const face of faces) {
        children.push(el('polygon', {
          points: pointsAttr(face.pts.map(project)),
          fill: 'ink',
          'fill-opacity': face.fillOpacity,
          stroke: 'paper',
          'stroke-width': strokeWidth,
          'stroke-linejoin': 'round',
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
