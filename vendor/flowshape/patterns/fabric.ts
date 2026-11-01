import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

export const fabric = definePattern({
  id: 'fabric',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: { continuous: ['warpAmount', 'dotSize', 'noiseScale', 'strokeWidth', 'size'], usesPhase: true },
  params: [
    { key: 'gridSize', kind: 'int', min: 20, max: 80, step: 1, default: 46, label: 'fabric.gridSize' },
    { key: 'warpAmount', kind: 'float', min: 0, max: 80, step: 1, default: 34, label: 'fabric.warpAmount' },
    { key: 'noiseScale', kind: 'float', min: 1, max: 10, step: 0.1, default: 3.5, label: 'fabric.noiseScale' },
    { key: 'mode', kind: 'enum', min: 0, max: 2, step: 1, default: 0, label: 'fabric.mode', options: ['fabric.dots', 'fabric.mesh', 'fabric.squares'] },
    { key: 'dotSize', kind: 'float', min: 0.4, max: 4, step: 0.05, default: 1.2, label: 'fabric.dotSize', dependsOn: { key: 'mode', values: [0] } },
    { key: 'strokeWidth', kind: 'float', min: 0.15, max: 1.5, step: 0.05, default: 0.4, label: 'fabric.strokeWidth', dependsOn: { key: 'mode', values: [1] } },
  ],
  generate(p, seed, size) {
    const noise = fbm2D(deriveSeed(seed, 'fabric'), 2);
    const g = p['gridSize']!;
    const margin = 20;
    const w = size.w - margin * 2, h = size.h - margin * 2;
    const s = p['noiseScale']! / Math.min(size.w, size.h);
    const warp = p['warpAmount']!;

    // The lattice stays where it is; the warp field slides underneath it, so
    // the cloth ripples rather than the weave sliding off the frame. Both
    // noise reads share the same drift, which is what keeps the displacement
    // a coherent flow field and not two unrelated wobbles.
    //
    // The drift is a circle in noise space, one turn per cycle: value noise
    // has no period (makeNoise2D hashes absolute lattice cells), so a closed
    // path is the only drift that returns to the field it started from.
    // (cos - 1) and sin are both exactly 0 at phase 0, so phase 0 and phase 1
    // are the identical read. The radius is small on purpose — the warp is
    // 34px at default, so a fifth of a noise cell already moves every dot
    // several pixels, and more turns the cloth into a churn.
    const ph = (p['phase'] ?? 0) % 1;
    const R = 0.2;
    const dx = R * (Math.cos(2 * Math.PI * ph) - 1);
    const dy = R * Math.sin(2 * Math.PI * ph);

    // Lattice of (gridSize x gridSize) points, warped in-place. The raw noise
    // reads (nx, ny — before the warpAmount pixel scale is applied) are kept
    // alongside px/py so squares mode can ride the identical fabric instead
    // of re-sampling it.
    const px: number[][] = [];
    const py: number[][] = [];
    const nxArr: number[][] = [];
    const nyArr: number[][] = [];
    for (let j = 0; j < g; j++) {
      px.push([]);
      py.push([]);
      nxArr.push([]);
      nyArr.push([]);
      for (let i = 0; i < g; i++) {
        const x = margin + (g === 1 ? 0 : (i / (g - 1)) * w);
        const y = margin + (g === 1 ? 0 : (j / (g - 1)) * h);
        const nx = noise(x * s + dx, y * s + dy);
        const ny = noise(x * s + 5.2 + dx, y * s + 1.3 + dy);
        px[j]!.push(x + warp * nx);
        py[j]!.push(y + warp * ny);
        nxArr[j]!.push(nx);
        nyArr[j]!.push(ny);
      }
    }

    const children: SvgNode[] = [];
    if (p['mode']! === 0) {
      const r = p['dotSize']!;
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          children.push(el('circle', {
            cx: px[j]![i]!.toFixed(2),
            cy: py[j]![i]!.toFixed(2),
            r: r.toFixed(2),
            fill: 'ink',
            stroke: 'none',
          }));
        }
      }
    } else if (p['mode']! === 1) {
      const sw = p['strokeWidth']!;
      for (let j = 0; j < g; j++) {
        let d = '';
        for (let i = 0; i < g; i++) {
          d += `${i ? 'L' : 'M'}${px[j]![i]!.toFixed(2)} ${py[j]![i]!.toFixed(2)}`;
        }
        children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': sw }));
      }
      for (let i = 0; i < g; i++) {
        let d = '';
        for (let j = 0; j < g; j++) {
          d += `${j ? 'L' : 'M'}${px[j]![i]!.toFixed(2)} ${py[j]![i]!.toFixed(2)}`;
        }
        children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': sw }));
      }
    } else {
      // Hiding squares (1960s computational-art lineage): each grid cell
      // draws a filled square whose translation, scale AND rotation all ride
      // the same warp noise (nx, ny above) that dots/mesh already read — low
      // noise leaves the square filling its cell, high noise shrinks, shifts
      // and turns it, exposing paper at the corners. A travelling
      // hiding-wave falls out of fabric's existing phase orbit for free
      // (nx/ny already drift with phase; nothing extra is needed here).
      //
      // No new param: the response is derived entirely from warpAmount
      // (reused here as a 0..1 "bite" via its own declared max, 80) and
      // noiseScale (already baked into nx/ny through `s`). warpAmount=0
      // collapses to a plain untouched grid of full-size squares, matching
      // the "no warp" look of the other two modes.
      const spacingX = g === 1 ? w : w / (g - 1);
      const spacingY = g === 1 ? h : h / (g - 1);
      const side0 = Math.min(spacingX, spacingY);
      const bite = Math.min(1, warp / 80);
      // 45 deg is the natural "square" rotation ceiling — never exceeded
      // since angle = ±r * maxAngle with r <= 1 (see below).
      const maxAngle = Math.PI / 4;
      // fbm2D's two raw noise reads rarely approach their theoretical [-1,1]
      // extremes — at the default noiseScale/gridSize the field's magnitude
      // (hypot(nx,ny)/sqrt2) typically sits under ~0.5 and only very rarely
      // nears 0.7. A response linear in that magnitude (the first cut of
      // this mode) stayed timid everywhere: even the default warpAmount
      // never pushed a typical cell far from full-size. LO/HI instead
      // remap that *actual* range through a smoothstep so the field's own
      // calm majority reads as genuinely full (below LO) and its noisy tail
      // reads as genuinely eaten (above HI), with the transition between
      // carrying the travelling wave — the contrast is the composition, not
      // a uniform dimming. GAIN is a concave (sqrt) function of `bite` so
      // that response strength itself ramps up fast — the current default
      // warpAmount (bite ≈ 0.42) already sits past half of GAIN's own
      // range — rather than crushing everything proportionally the way a
      // linear multiplier by `bite` did.
      const LO = 0.12, HI = 0.42;
      const gain = Math.sqrt(bite);
      const smoothstep = (lo: number, hi: number, x: number): number => {
        const u = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
        return u * u * (3 - 2 * u);
      };
      // How far the (pre-shrink) side, once fully eaten, still shrinks:
      // side ends up around side0/extent * (1 - SHRINK_AMT), which lands a
      // fully-hidden, fully-rotated square around a quarter of its cell's
      // side — clearly "eaten" without vanishing outright.
      const SHRINK_AMT = 0.62;
      for (let j = 0; j < g; j++) {
        for (let i = 0; i < g; i++) {
          const cx = margin + (g === 1 ? 0 : (i / (g - 1)) * w);
          const cy = margin + (g === 1 ? 0 : (j / (g - 1)) * h);
          const nx = nxArr[j]![i]!;
          const ny = nyArr[j]![i]!;
          const hyp = Math.hypot(nx, ny);
          // Unit direction of the (nx, ny) noise vector — continuous even
          // where its raw magnitude is unstable, because `r` below (which
          // every use of dirX/dirY is multiplied by) vanishes there too.
          const dirX = hyp > 1e-6 ? nx / hyp : 0;
          const dirY = hyp > 1e-6 ? ny / hyp : 0;
          const t = Math.min(1, hyp / Math.SQRT2);
          const r = smoothstep(LO, HI, t) * gain;
          const angle = r * maxAngle * dirX;

          // A square of half-side `half` rotated by `angle` has its widest
          // corner spread, on EITHER axis, at exactly half*(|cos|+|sin|) —
          // 1 at angle 0, growing to sqrt2 at the 45 deg ceiling. Capping
          // the (pre-shrink) side at side0/extent is what stops a barely
          // -shrunk but steeply-rotated square from poking out of its cell
          // with zero translation left to absorb it: even before any extra
          // response-driven shrink, the rotated bounding box already fits
          // inside the tighter cell axis. The extra shrink (by `r`, the
          // remapped response) then only makes the square smaller still,
          // freeing up room for the translation below.
          const extent = Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle));
          const sideCap = side0 / extent;
          const side = sideCap * (1 - r * SHRINK_AMT);

          // Exact (not worst-case) half-width of the rotated square's
          // bounding box, identical on both axes by symmetry. Keeping it
          // within each axis's own half-spacing of the cell centre — after
          // the translation below — is what guarantees a square never
          // crosses into a neighbouring cell at any gridSize / warpAmount /
          // noiseScale corner randomize can reach: two neighbours' bounding
          // boxes can at most touch at the shared cell boundary.
          const half = side / 2;
          const cornerExtent = half * extent;
          const maxOffX = Math.max(0, spacingX / 2 - cornerExtent);
          const maxOffY = Math.max(0, spacingY / 2 - cornerExtent);
          const fx = cx + dirX * r * maxOffX;
          const fy = cy + dirY * r * maxOffY;

          const cosA = Math.cos(angle), sinA = Math.sin(angle);
          const corners: [number, number][] = [
            [-half, -half], [half, -half], [half, half], [-half, half],
          ];
          const pts = corners
            .map(([lx, ly]) => {
              const rx = lx * cosA - ly * sinA + fx;
              const ry = lx * sinA + ly * cosA + fy;
              return `${rx.toFixed(2)},${ry.toFixed(2)}`;
            })
            .join(' ');
          children.push(el('polygon', { points: pts, fill: 'ink', stroke: 'none' }));
        }
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
