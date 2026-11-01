/**
 * Marching squares over a padded scalar lattice.
 *
 * A lattice is W × H samples `G` with world coordinates `x(I)`, `y(J)`. For a
 * threshold t, every cell whose corners straddle t contributes one segment
 * (two on a saddle, split by the centre sample), with the crossing placed by
 * linear interpolation along the cell edge. Segments are keyed by the lattice
 * edge they cross — horizontal edge (I,J)–(I+1,J) is 2·(J·W + I), vertical
 * edge (I,J)–(I,J+1) is that + 1 — so each crossing point is computed once
 * and shared by the two cells that meet on it, and chaining "the other
 * segment on this edge" walks every loop back to its start.
 *
 * Callers pad the lattice with a ring of samples below (or above) every
 * threshold they will ask for, so every loop closes; `ring` marks the points
 * that were interpolated against such a sample — a caller that wants open
 * contours lifts the pen between two ring points, which is the frame edge.
 *
 * Lorensen, W. E. & Cline, H. E. (1987), the 2-D case.
 */

export interface ScalarLattice {
  W: number;
  H: number;
  G: Float32Array;
  /** The value the padding ring holds — outside every threshold asked for. */
  pad: number;
  x(I: number): number;
  y(J: number): number;
}

/** One closed loop: flat [x0, y0, x1, y1, …] and a per-point ring flag. */
export interface Loop { pts: number[]; ring: number[] }

/**
 * A lattice over a frame: real samples at pitch `cell` covering the frame
 * plus one cell beyond it on every side, then the padding ring. Sampling
 * past the frame is what lets a level set cross the sheet edge inside a real
 * cell — interpolated where the field actually reaches the threshold —
 * instead of stopping at the last interior sample; coordinates are clamped
 * to the frame so the overhang and the ring both land on the edge.
 * Returns the lattice with the sampled range, for callers that pick their
 * thresholds from it.
 */
export function frameLattice(
  size: { w: number; h: number },
  cell: number,
  pad: number,
  sample: (x: number, y: number) => number,
): ScalarLattice & { lo: number; hi: number } {
  const cols = Math.ceil(size.w / cell) + 3, rows = Math.ceil(size.h / cell) + 3;
  const W = cols + 2, H = rows + 2;
  const G = new Float32Array(W * H).fill(pad);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = sample((i - 1) * cell, (j - 1) * cell);
      G[(i + 1) + (j + 1) * W] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return {
    W, H, G, pad, lo, hi,
    x: (I) => Math.min(size.w, Math.max(0, (I - 2) * cell)),
    y: (J) => Math.min(size.h, Math.max(0, (J - 2) * cell)),
  };
}

/** Builds a marcher whose scratch arrays are sized once for the lattice. */
export function makeMarcher(lat: ScalarLattice): (t: number) => Loop[] {
  const { W, H, G } = lat;
  const E = W * H * 2;
  const px = new Float32Array(E), py = new Float32Array(E);
  const onRing = new Uint8Array(E);
  const slotA = new Int32Array(E), slotB = new Int32Array(E);
  const segE0: number[] = [], segE1: number[] = [];

  return (t: number): Loop[] => {
    slotA.fill(-1); slotB.fill(-1);
    segE0.length = 0; segE1.length = 0;
    const cross = (I0: number, J0: number, I1: number, J1: number, e: number): void => {
      const a = G[I0 + J0 * W]!, b = G[I1 + J1 * W]!;
      const u = (t - a) / (b - a);
      px[e] = lat.x(I0) + (lat.x(I1) - lat.x(I0)) * u;
      py[e] = lat.y(J0) + (lat.y(J1) - lat.y(J0)) * u;
      onRing[e] = a === lat.pad || b === lat.pad ? 1 : 0;
    };
    const seg = (e0: number, e1: number): void => {
      const k = segE0.length;
      segE0.push(e0); segE1.push(e1);
      if (slotA[e0]! < 0) slotA[e0] = k; else slotB[e0] = k;
      if (slotA[e1]! < 0) slotA[e1] = k; else slotB[e1] = k;
    };
    for (let J = 0; J < H - 1; J++) {
      for (let I = 0; I < W - 1; I++) {
        const tl = G[I + J * W]!, tr = G[I + 1 + J * W]!, br = G[I + 1 + (J + 1) * W]!, bl = G[I + (J + 1) * W]!;
        const c = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const top = 2 * (J * W + I), bottom = 2 * ((J + 1) * W + I);
        const left = top + 1, right = 2 * (J * W + I + 1) + 1;
        if (c & 8 ? !(c & 4) : !!(c & 4)) cross(I, J, I + 1, J, top);
        if (c & 1 ? !(c & 2) : !!(c & 2)) cross(I, J + 1, I + 1, J + 1, bottom);
        if (c & 8 ? !(c & 1) : !!(c & 1)) cross(I, J, I, J + 1, left);
        if (c & 4 ? !(c & 2) : !!(c & 2)) cross(I + 1, J, I + 1, J + 1, right);
        switch (c) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: // TR + BL: the centre sample decides which pair joins.
            if ((tl + tr + br + bl) / 4 >= t) { seg(left, top); seg(bottom, right); }
            else { seg(left, bottom); seg(top, right); }
            break;
          case 10: // TL + BR
            if ((tl + tr + br + bl) / 4 >= t) { seg(top, right); seg(bottom, left); }
            else { seg(top, left); seg(right, bottom); }
            break;
        }
      }
    }
    const used = new Uint8Array(segE0.length);
    const loops: Loop[] = [];
    for (let k0 = 0; k0 < segE0.length; k0++) {
      if (used[k0]) continue;
      used[k0] = 1;
      const start = segE0[k0]!;
      let e = segE1[k0]!;
      const pts: number[] = [px[start]!, py[start]!];
      const ring: number[] = [onRing[start]!];
      let guard = segE0.length + 1;
      while (e !== start && guard-- > 0) {
        pts.push(px[e]!, py[e]!);
        ring.push(onRing[e]!);
        const k = slotA[e]! >= 0 && !used[slotA[e]!] ? slotA[e]! : slotB[e]! >= 0 && !used[slotB[e]!] ? slotB[e]! : -1;
        if (k < 0) break;
        used[k] = 1;
        e = segE0[k] === e ? segE1[k]! : segE0[k]!;
      }
      loops.push({ pts, ring });
    }
    return loops;
  };
}

/** Serialises loops as SVG path data. Closed: every loop ends in Z. Open: the
 *  pen lifts between two consecutive ring points (the frame edge) and the
 *  loop is closed back to its start only when that closing run is not itself
 *  along the edge. `fmt` rounds a coordinate. */
export function loopsToPath(loops: Loop[], open: boolean, fmt: (v: number) => string): string {
  let d = '';
  for (const { pts, ring } of loops) {
    d += 'M' + fmt(pts[0]!) + ' ' + fmt(pts[1]!);
    for (let i = 1; i * 2 < pts.length; i++) {
      const lift = open && ring[i - 1] && ring[i];
      d += (lift ? 'M' : 'L') + fmt(pts[2 * i]!) + ' ' + fmt(pts[2 * i + 1]!);
    }
    if (open) {
      const last = ring.length - 1;
      if (!(ring[last] && ring[0])) d += 'L' + fmt(pts[0]!) + ' ' + fmt(pts[1]!);
    } else {
      d += 'Z';
    }
  }
  return d;
}
