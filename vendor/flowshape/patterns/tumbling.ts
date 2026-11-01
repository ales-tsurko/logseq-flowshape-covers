import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

type Vec2 = [number, number];

const f2 = (n: number): string => n.toFixed(2);

/**
 * The rhombille tiling: each hexagon of a pointy-top hex lattice is split into
 * three 60°/120° rhombi meeting at its centre, and the three are shaded
 * light / mid / dark so the hexagon reads as a cube seen corner-on. Edge to
 * edge, no silhouette, no fit-to-frame — a quilt, not an object.
 *
 * The subject is the reversible-cube ambiguity. Reverse a hexagon's tone
 * triple and its cube pops *in* instead of *out*; nothing else about the
 * geometry changes, because the three rhombi are congruent and the tiling is
 * identical either way. `coherence` decides how the flips are distributed: at
 * 0 they are white noise and the surface fizzes salt-and-pepper; at 1 they
 * follow a smooth fbm field, giving continent-sized regions of raised and
 * sunken blocks meeting along a coastline the eye can't fix.
 */
export const tumbling = definePattern({
  id: 'tumbling',
  family: 'isometric',
  phase: 1,
  heavy: false,
  // Randomness is this pattern's subject, not a garnish, so the seed has to be
  // live at *default* params — and live in the element *set*, not merely in
  // paint order (see the long note in voxel.ts around `usesSeed`, and
  // tests/patterns/harness.ts:67, which compares the sorted element list
  // precisely so a reordering-only seed fails).
  //
  // Two independent seed-derived streams reach the output here:
  //   1. `voidChance` drops that fraction of hexagons. A different seed drops a
  //      *different* set, so in `tones` mode the polygon count and coordinates
  //      both change, and in `hatch` mode — where the element count is pinned at
  //      4 — the `d` strings of all four paths change. This stream is INERT at
  //      the default, which is 0; stream 2 is what keeps the seed live there.
  //   2. The flip decision mixes a white-noise draw with an fbm field that is
  //      itself seed-derived ('tumbling-field'), so the seed stays live at
  //      *every* coherence value, not just at coherence 0. A flip moves a
  //      rhombus between tone buckets, which in hatch mode moves its hatch
  //      lines between the three path elements.
  usesSeed: true,
  anim: { continuous: ['flipChance', 'coherence', 'voidChance', 'faceShading', 'size'], usesPhase: true },
  params: [
    { key: 'cell', kind: 'int', min: 8, max: 44, step: 1, default: 24, label: 'tumbling.cell' },
    { key: 'flipChance', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.38, label: 'tumbling.flipChance' },
    { key: 'coherence', kind: 'float', min: 0, max: 1, step: 0.01, default: 0.45, label: 'tumbling.coherence' },
    // Defaults to 0: the tumbling-blocks illusion is the point of this pattern,
    // and dropped hexagons read as holes punched in a solid, which fights it.
    // The eroded look is still one drag away.
    { key: 'voidChance', kind: 'float', min: 0, max: 0.5, step: 0.01, default: 0, label: 'tumbling.voidChance' },
    { key: 'render', kind: 'enum', min: 0, max: 1, step: 1, default: 0, label: 'tumbling.render', options: ['tumbling.tones', 'tumbling.hatch'] },
    // Line count per face is scale-invariant — spacing is S/(density·tone) while
    // the face itself is ∝ S — so this is literally "lines across the darkest
    // face", not a length. Below ~6 a face carries one or two strokes and the
    // hatch reads as broken dashes rather than tone; the range starts high
    // enough that every sampled value is a legible fill.
    { key: 'hatchDensity', kind: 'float', min: 4, max: 20, step: 0.1, default: 11, label: 'tumbling.hatchDensity', dependsOn: { key: 'render', values: [1] } },
    // Floored at 0.15, not 0, on purpose: randomParams samples every
    // non-cosmetic param across its whole range and *will* pick the minimum.
    // At 0 the three tones collapse to one, the rhombille reads as a flat ink
    // rectangle, and the cube — the entire subject — disappears.
    { key: 'faceShading', kind: 'float', min: 0.15, max: 1, step: 0.01, default: 0.72, label: 'tumbling.faceShading' },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 2, step: 0.05, default: 0.5, label: 'tumbling.strokeWidth' },
  ],
  generate(p, seed, size) {
    const S = p['cell']!;
    const flipChance = p['flipChance']!;
    const coherence = p['coherence']!;
    const voidChance = p['voidChance']!;
    const renderMode = p['render']!;
    const hatchDensity = p['hatchDensity']!;
    const faceShading = p['faceShading']!;
    const strokeWidth = p['strokeWidth']!;

    const rnd = mulberry32(deriveSeed(seed, 'tumbling'));
    const field = fbm2D(deriveSeed(seed, 'tumbling-field'), 2);
    // ~3 noise cells across the short edge: continent-sized regions, not grain.
    const kappa = 3 / Math.min(size.w, size.h);

    // Intrinsic motion: the lattice never moves, the flip field does. The
    // sample point walks a circle in noise space, once per cycle.
    //
    // A circle and not a straight drift, for two independent reasons.
    //   1. makeNoise2D hashes absolute integer lattice cells, so it is not
    //      periodic in anything: no non-zero translation ever returns to the
    //      field it started from. A closed path does, exactly — and `% 1`
    //      plus (cos - 1)/sin, both exactly 0 at phase 0, make phase 1 the
    //      literal phase-0 sample rather than an approximation of it.
    //   2. Fizz. `u < flipChance` is a hard threshold, so a hexagon whose u
    //      wanders across it repeatedly would strobe. Over a circle small
    //      relative to a noise cell a smooth field is well approximated by
    //      its own gradient, which makes u(phase) a single sinusoid: one
    //      up-crossing and one down-crossing per cycle per hexagon. RADIUS
    //      is what buys that, and it is why it is under a third of a cell
    //      and not a whole one — push it past ~0.5 and the second fbm octave
    //      (period 0.5 cells) starts folding higher harmonics into u, which
    //      is exactly the chatter it avoids.
    const TAU = 2 * Math.PI;
    const ph = (p['phase'] ?? 0) % 1;
    const RADIUS = 0.3;
    const driftX = RADIUS * (Math.cos(TAU * ph) - 1);
    const driftY = RADIUS * Math.sin(TAU * ph);

    // The drift alone does not read as a wave, and it took watching the stage
    // to find out why. The field is ~3 noise cells across, so its coastlines
    // run all over the quilt at once; drifting it flips hexagons along every
    // one of them simultaneously, which the eye reads as cubes popping at
    // random over the whole surface rather than as anything crossing it.
    // Worse at the default coherence of 0.45, where 55% of `u` is
    // per-hexagon white noise and the coastline is dithered to begin with.
    // Two rounds on the stage: a full-wavelength sinusoid in the flip
    // threshold was no better, because half the frame is inside it at any
    // moment and the flips stay spread out.
    //
    // What reads as a wave is a *narrow, strong* one. A raised cosine to the
    // fourth is a pulse about a fifth of the frame diagonal wide; at 0.65 it
    // lifts the threshold far enough that essentially every hexagon it
    // reaches reverses, and reverses back as it leaves. That is what the
    // quilt needed: cubes popping in and out along a moving front, a band of
    // agreeing cubes crossing a mottled field. Measured over one cycle, 41%
    // of hexagons take part and every single one of them flips exactly twice
    // — in and back — so the front is emphatic and there is no chatter
    // anywhere in it. A weaker pulse (0.22) was tried first and was too
    // faint to see against the dither at all.
    //
    // sin²(pi*ph) is the envelope that makes the pulse vanish at phase 0 —
    // no travelling wave can be identically zero at one phase on its own,
    // and an envelope costs less than the alternative, which is a companion
    // term that leaves a permanent stripe frozen at one edge. It is also
    // smooth at the wrap (it is (1 - cos(2pi*ph))/2, so value and slope both
    // return), and it puts the front at full strength mid-crossing, which is
    // where it is most visible anyway. The orbit underneath never stops, so
    // the surface is still alive at phase 0 where the pulse is nil.
    //
    // Faded out near either end of flipChance, so the parameter values that
    // mean "every cube the same way round" go on meaning it.
    const gateAmp = 0.65 * Math.min(1, flipChance / 0.15, (1 - flipChance) / 0.15);
    const gateEnv = gateAmp * 0.5 * (1 - Math.cos(TAU * ph));
    const gateSpan = size.w + size.h;

    // Hexagon corners, pointy-top, as offsets from the centre:
    //   V_k = S·(cos(-π/2 + kπ/3), sin(-π/2 + kπ/3))
    // V0 top, V1 upper-right, V2 lower-right, V3 bottom, V4 lower-left,
    // V5 upper-left. Same vertex set as girih.ts's lattice, indexed from the
    // top corner instead of the lower-right one.
    const W = (S * Math.sqrt(3)) / 2;
    const H = S / 2;
    const V: Vec2[] = [[0, -S], [W, -H], [W, H], [0, S], [-W, H], [-W, -H]];

    // The three rhombi, each written as centre + a·e1 + b·e2 with a,b ∈ [0,1].
    // Corners are therefore C, C+e1, C+e1+e2, C+e2 — which spells out
    //   top   C,V5,V0,V1     right C,V1,V2,V3     left  C,V3,V4,V5
    // and reproduces voxel.ts's three unit-cube faces exactly: the edge-vector
    // pairs match {(±√3/2,-1/2), (0,1)} face for face.
    const FACES: { e1: Vec2; e2: Vec2 }[] = [
      { e1: V[5]!, e2: V[1]! }, // top
      { e1: V[1]!, e2: V[3]! }, // right
      { e1: V[3]!, e2: V[5]! }, // left
    ];

    // voxel.ts's three tone levels {1, 1-0.45·s, 1-0.75·s}, but ordered
    // ascending in ink so that *reversing the triple* is exactly the cube
    // reversal: unflipped the top rhombus takes the lightest tone (lit from
    // above, cube pops out); flipped it takes the darkest and the cube sinks.
    const TONES = [1 - 0.75 * faceShading, 1 - 0.45 * faceShading, 1];

    // Every rhombus has the same perpendicular height across the b axis:
    // |e2 × ê1| = (√3/2)·S. Hatch lines run b = const, a: 0→1, so they are
    // exact chords of the rhombus and need no clipping at all.
    const perp = W;
    // Darker tone ⇒ tighter spacing. The 2·strokeWidth floor is what stops a
    // small cell at high density from inking the face solid.
    const lineCount = TONES.map((t) => {
      const spacing = Math.max(S / (hatchDensity * t), 2 * strokeWidth);
      return Math.max(1, Math.floor(perp / spacing));
    });

    const rMax = Math.ceil(size.h / (S * 1.5)) + 1;
    // q must reach far enough left to cover the r/2 shear at the bottom row,
    // hence the rMax/2 term on top of the plain width span.
    const qMax = Math.ceil(size.w / (S * Math.sqrt(3))) + Math.ceil(rMax / 2) + 2;

    const hatch: string[][] = [[], [], []];
    const outline: string[] = [];
    const polys: SvgNode[] = [];

    for (let r = -1; r <= rMax; r++) {
      for (let q = -qMax; q <= qMax; q++) {
        // Both draws happen for every lattice site, before any skip decision,
        // so a hexagon's randomness depends only on its own (q,r) and never on
        // how many earlier hexagons survived the void cull — the same
        // population-independence discipline voxel.ts documents at step 2.
        const r0 = rnd();
        const r1 = rnd();

        const hx = S * Math.sqrt(3) * (q + r / 2);
        const hy = S * 1.5 * r;
        if (hx < -S || hx > size.w + S || hy < -S || hy > size.h + S) continue;
        if (r0 < voidChance) continue;

        const u = (1 - coherence) * r1
          + coherence * (0.5 + 0.5 * field(hx * kappa + driftX, hy * kappa + driftY));
        const sp = (hx + hy) / gateSpan;
        const bump = 0.5 * (1 + Math.cos(TAU * (ph - sp)));
        const gate = gateEnv * bump * bump * bump * bump;
        const flipped = u < flipChance + gate;

        if (renderMode === 1) {
          outline.push(
            `M${f2(hx + V[0]![0])} ${f2(hy + V[0]![1])}` +
            V.slice(1).map((v) => `L${f2(hx + v[0])} ${f2(hy + v[1])}`).join('') +
            'Z',
          );
        }

        for (let fi = 0; fi < 3; fi++) {
          const tone = flipped ? 2 - fi : fi;
          const { e1, e2 } = FACES[fi]!;
          if (renderMode === 1) {
            const n = lineCount[tone]!;
            const bucket = hatch[tone]!;
            for (let i = 0; i < n; i++) {
              const b = (i + 0.5) / n;
              const x0 = hx + b * e2[0], y0 = hy + b * e2[1];
              bucket.push(`M${f2(x0)} ${f2(y0)}L${f2(x0 + e1[0])} ${f2(y0 + e1[1])}`);
            }
          } else {
            const pts =
              `${f2(hx)},${f2(hy)} ` +
              `${f2(hx + e1[0])},${f2(hy + e1[1])} ` +
              `${f2(hx + e1[0] + e2[0])},${f2(hy + e1[1] + e2[1])} ` +
              `${f2(hx + e2[0])},${f2(hy + e2[1])}`;
            polys.push(el('polygon', {
              points: pts,
              fill: 'ink',
              'fill-opacity': TONES[tone]!,
              stroke: 'paper',
              'stroke-width': strokeWidth,
              'stroke-linejoin': 'round',
            }));
          }
        }
      }
    }

    if (renderMode === 0) {
      return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, polys);
    }

    // Exactly four elements, whatever the cell size: three tone buckets plus
    // the hexagon lattice itself.
    const children: SvgNode[] = hatch.map((bucket) => el('path', {
      d: bucket.join(''),
      fill: 'none',
      stroke: 'ink',
      'stroke-width': strokeWidth,
      'stroke-linecap': 'round',
    }));
    children.push(el('path', {
      d: outline.join(''),
      fill: 'none',
      stroke: 'ink',
      'stroke-width': strokeWidth,
      'stroke-linejoin': 'round',
    }));
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
