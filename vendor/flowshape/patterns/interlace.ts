import { el } from '../core/svg';
import { definePattern } from './registry';

/**
 * Ribbon Interlace — a flat Celtic weave on a honeycomb.
 *
 * Every hexagonal face carries a closed hexagonal ribbon ring; every
 * honeycomb *vertex* (a hexagon corner, shared by three faces) carries a
 * Y-shaped tri-radiate strand whose three arms reach into the three rings
 * around it.
 *
 * The over/under alternation is free. The honeycomb graph is bipartite (the
 * graphene A/B sublattices), and with corners indexed k = 0..5 from the
 * lattice's own angular origin, the class of a corner is exactly `k % 2` —
 * consistently across all three faces that share it. (Concretely: the corner
 * at angle -90° of one face is the corner at +30° of one neighbour and at
 * +150° of the other; 0, 2, 4 — all even. The same holds for every corner.)
 * So the rule "ring passes over arm at even corners, arm over ring at odd
 * corners" reads over/under/over/under/over/under around every single ring,
 * globally consistent, with zero randomness and zero bookkeeping. Six being
 * even is exactly why the motif is a hexagon.
 *
 * Occlusion is Celtic gap-cutting rather than painting: whichever strand
 * goes under is *cut* either side of the crossing, so no two bands overlap
 * anywhere in the drawing and the ink/paper pairs may be emitted in any
 * order. Butt caps make the break read as the classic open-ended gap.
 */
export const interlace = definePattern({
  id: 'interlace',
  family: 'tilings',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['ribbonWidth', 'ringScale', 'gapScale', 'strokeWidth', 'size'] },
  params: [
    { key: 'cell', kind: 'int', min: 16, max: 70, step: 1, default: 34, label: 'interlace.cell' },
    { key: 'ribbonWidth', kind: 'float', min: 0.06, max: 0.30, step: 0.01, default: 0.16, label: 'interlace.ribbonWidth' },
    { key: 'ringScale', kind: 'float', min: 0.45, max: 0.85, step: 0.01, default: 0.68, label: 'interlace.ringScale' },
    { key: 'coreRatio', kind: 'float', min: 0.25, max: 0.75, step: 0.01, default: 0.45, label: 'interlace.coreRatio' },
    { key: 'junctions', kind: 'bool', min: 0, max: 1, step: 1, default: 1, label: 'interlace.junctions' },
    { key: 'gapScale', kind: 'float', min: 0.8, max: 2.5, step: 0.05, default: 1.2, label: 'interlace.gapScale', dependsOn: { key: 'junctions', values: [1] } },
    { key: 'strokeWidth', kind: 'float', min: 0.3, max: 2.5, step: 0.05, default: 0.8, label: 'interlace.strokeWidth' },
  ],
  generate(p, _seed, size) {
    const S = p['cell']!;
    const rw = p['ribbonWidth']!;
    const W = rw * S; // ribbon band width, in px
    const core = p['coreRatio']!;
    const sw = p['strokeWidth']!;
    const weave = p['junctions']! >= 0.5;

    // The three ring corners around a honeycomb vertex sit √3·(1−ringScale)·S
    // apart, and each arm has (1−ringScale)·S of free run before it meets its
    // ring. A wide ribbon on a large ring would make both of those shorter
    // than the band itself: rings of neighbouring faces would fuse and the
    // gap-cut would eat whole arms. Capping ringScale keeps the free arm run
    // at >= 1.5 band widths, which is exactly enough for every clearance
    // below to hold. At the shipped defaults (0.68 vs a cap of 0.76) this is
    // inert; it only bites when ribbonWidth is pushed high.
    const rs = Math.min(p['ringScale']!, 1 - 1.5 * rw);

    const edge = rs * S; // ring side length (a regular hexagon's side = its circumradius)
    const crossDist = (1 - rs) * S; // honeycomb vertex -> its ring corner

    // Both ring edges leave a corner at 60° to that corner's bisector, and the
    // arm runs along the bisector — so the crossing angle is a constant 60°.
    //
    // Gap half-length. At gapScale 1 this is exactly the clearance at which the
    // under-strand's butt-capped end stops touching the over-strand's band:
    // the end sits (t·sinθ) off the over-strand's axis and its own cap reaches
    // (W_under/2)·cosθ back toward it, so t·sinθ − (W_under/2)·cosθ ≥ W_over/2.
    const TH = Math.PI / 3;
    const t0 = ((W / 2 + (W / 2) * Math.cos(TH)) / Math.sin(TH)) * p['gapScale']!;
    // The one place the design can fall apart: a fat ribbon on a small ring
    // makes t0 longer than the strand it is cutting, and the under-strand
    // vanishes. Never remove more than 40% of a strand's own length.
    const tRing = Math.min(t0, 0.4 * edge);

    // An arm must reach past the cut ends of the ring it crosses, or the
    // pass-over reads as two strands that merely stop near each other. The ring's
    // cut ends reach (tRing·cos60 + (W/2)·cos30) along the arm's axis past the
    // corner; clear that by another quarter band.
    const overshoot = 0.5 * tRing + 0.7 * W;
    const armLen = crossDist + overshoot;
    const tArm = Math.min(t0, 0.4 * armLen);

    const ux: number[] = [], uy: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 3;
      ux.push(Math.cos(a));
      uy.push(Math.sin(a));
    }

    const f2 = (n: number) => n.toFixed(2);
    let ringD = '', armD = '';

    const rMax = Math.ceil(size.h / (S * 1.5)) + 2;
    const qMax = Math.ceil(size.w / (S * Math.sqrt(3))) + 3;
    for (let r = -2; r <= rMax; r++) {
      for (let q = -qMax; q <= qMax; q++) {
        const hx = S * Math.sqrt(3) * (q + r / 2);
        const hy = S * 1.5 * r;
        const m = S * 1.2;
        if (hx < -m || hx > size.w + m || hy < -m || hy > size.h + m) continue;

        const px: number[] = [], py: number[] = [];
        for (let k = 0; k < 6; k++) {
          px.push(hx + edge * ux[k]!);
          py.push(hy + edge * uy[k]!);
        }

        if (!weave) {
          // Nothing crosses anything, so the ring stays whole.
          ringD += `M${f2(px[0]!)} ${f2(py[0]!)}`;
          for (let k = 1; k < 6; k++) ringD += `L${f2(px[k]!)} ${f2(py[k]!)}`;
          ringD += 'Z';
          continue;
        }

        // Ring: cut at the three odd corners, leaving three arcs, each one
        // running from just past an odd corner, through the even corner in
        // its middle, to just short of the next odd corner.
        const f = tRing / edge;
        for (let j = 0; j < 3; j++) {
          const k1 = 2 * j + 1, k2 = (2 * j + 2) % 6, k3 = (2 * j + 3) % 6;
          const ax = px[k1]! + (px[k2]! - px[k1]!) * f;
          const ay = py[k1]! + (py[k2]! - py[k1]!) * f;
          const cx = px[k2]! + (px[k3]! - px[k2]!) * (1 - f);
          const cy = py[k2]! + (py[k3]! - py[k2]!) * (1 - f);
          ringD += `M${f2(ax)} ${f2(ay)}L${f2(px[k2]!)} ${f2(py[k2]!)}L${f2(cx)} ${f2(cy)}`;
        }

        // Arms: one per (face, corner) pair, which enumerates every arm of
        // every Y-junction exactly once without any vertex bookkeeping.
        for (let k = 0; k < 6; k++) {
          const vx = hx + S * ux[k]!, vy = hy + S * uy[k]!;
          const dx = -ux[k]!, dy = -uy[k]!;
          if (k % 2 === 1) {
            // Odd (B) vertex: the arm passes over its ring, uncut.
            armD += `M${f2(vx)} ${f2(vy)}L${f2(vx + dx * armLen)} ${f2(vy + dy * armLen)}`;
          } else {
            // Even (A) vertex: the ring passes over, so cut the arm.
            const outer = crossDist - tArm;
            if (outer > 0.05) {
              armD += `M${f2(vx)} ${f2(vy)}L${f2(vx + dx * outer)} ${f2(vy + dy * outer)}`;
            }
            // The far tip usually disappears into the gap; when it doesn't,
            // anything shorter than half a band width is a blob, not a tail.
            const inner = crossDist + tArm;
            if (armLen - inner > 0.5 * W) {
              armD += `M${f2(vx + dx * inner)} ${f2(vy + dy * inner)}`
                + `L${f2(vx + dx * armLen)} ${f2(vy + dy * armLen)}`;
            }
          }
        }
      }
    }

    // A wide ink stroke with a narrower paper stroke over it is the whole
    // ribbon: two parallel ink edges around a paper core, no offset curves.
    // strokeWidth acts as a floor on the edge weight, so a thin ribbon still
    // reads as a band rather than a hairline pair.
    const paperW = Math.max(0, Math.min(W * core, W - 2 * sw));
    const band = (d: string, stroke: string, width: number) =>
      el('path', {
        d, fill: 'none', stroke,
        'stroke-width': width,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'butt',
      });

    const children = [band(ringD, 'ink', W), band(ringD, 'paper', paperW)];
    if (weave) children.push(band(armD, 'ink', W), band(armD, 'paper', paperW));

    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
