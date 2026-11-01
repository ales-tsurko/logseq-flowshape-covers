import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';

const MARGIN = 24;
// Fixed vertex count per line — nothing appears/vanishes as params move.
// Must comfortably out-sample the fastest fringe: at max frequency the
// path-length difference sweeps roughly frequency·width radians across one
// line, and this needs ~10+ samples per cycle or the sine aliases into
// jagged zigzags instead of smooth fringes (verified against a first,
// too-coarse render — see the deviations note in the commit message).
const SAMPLES = 420;

/**
 * Two-/three-source circular-wave interference on a bed of horizontal
 * lines: z(x, y) = Σ sin(kᵢ·dist((x, y), Sᵢ) + φᵢ), each line's vertex
 * displaced vertically by z·amplitude. With equal kᵢ, a single term's
 * level sets are circles about Sᵢ; the SUM's fringes — where the phase
 * difference k·(r₁ − r₂) crosses a multiple of 2π — sit exactly on the
 * hyperbola family with foci at the sources (Fermat's two-source
 * construction, the textbook double-slit pattern). That's forced by the
 * distance-field geometry, not tuned — this pattern's forced-order
 * commitment. The `sources` built below sit symmetrically about the
 * frame's vertical axis, which gives the SOURCE PLACEMENT mirror symmetry
 * unconditionally. The rendered field itself is exactly mirror-symmetric
 * only in the special case k₁ = k₂ and φ₁ = φ₂ (swapping the two sources
 * must leave the sum unchanged); at defaults `detune` ≠ 0 and the two
 * seeded φᵢ are independent draws, so both break exact bilateral symmetry
 * on purpose — the composition reads as *approximately* symmetric (the
 * dominant term is the symmetric geometry) while still varying with seed
 * in a way that a shared single phase draw could not (see `phi0` below).
 * `detune` breaks the equal-k premise: k₂/k₁ = 1 + detune, turning the
 * static hyperbolae into fringes that visibly drift as phase advances.
 *
 * Register: the default lands in the dramatic look (~100 lines, separation
 * far off-canvas, ~4 fringes across the frame, amplitude well over 10×
 * the row spacing) where the lines keep their horizontal identity — they
 * sweep in a few big S-curves, not rings — while displacement is large
 * enough that neighbouring lines cross deep and stay crossed over a real
 * stretch of x. Those sustained crossings are what braid into luminous,
 * silk-like ribbons under the translucent stroke, concentrated where the
 * sweeps converge; that's the entire point of the pattern. Dropping
 * `lines` and `amplitude` (keeping the same off-canvas geometry) reaches
 * a calmer, non-crossing register — still visibly two-source, just gentle;
 * neither corner is special-cased or clamped away.
 *
 * A first pass kept the sources within the frame (separation a few hundred
 * pixels) with a much higher frequency: that reads as a bullseye — closed
 * concentric rings around a visible centre, the lines losing their
 * horizontal identity into circular banding — which is the wrong register
 * (see the commit's deviations note). Pushing the sources off-canvas is
 * what removes the closed-ring topology; only then does raising the
 * amplitude relative to the row spacing turn "a few lines touch" into
 * "the whole frame reads as braided."
 */
export const interference = definePattern({
  id: 'interference',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: {
    continuous: ['frequency', 'amplitude', 'separation', 'detune', 'strokeWidth', 'opacity', 'size'],
    usesPhase: true,
  },
  params: [
    { key: 'lines', kind: 'int', min: 16, max: 140, step: 1, default: 100, label: 'interference.lines' },
    { key: 'sources', kind: 'int', min: 2, max: 3, step: 1, default: 2, label: 'interference.sources' },
    // Units are radians per pixel of raw distance (the formula is physical,
    // not normalised 0..1 like chirp's sweep), so this has to stay small:
    // at a 1920px frame width, frequency·width/(2π) is roughly the fringe
    // count across the frame — the default (~4 fringes) keeps the lines
    // reading as a few big sweeps, not a dense grating.
    { key: 'frequency', kind: 'float', min: 0.002, max: 0.06, step: 0.0005, default: 0.013, label: 'interference.frequency' },
    // "Several times the row spacing" (≈100 lines over ~1030px ⇒ spacing
    // ≈10px) so neighbouring lines don't just touch, they cross deep and
    // stay crossed over a real stretch of x — that sustained overlap under
    // a translucent stroke is what reads as a braided, silk-like ribbon
    // rather than a faint touch.
    { key: 'amplitude', kind: 'float', min: 2, max: 200, step: 0.5, default: 150, label: 'interference.amplitude' },
    // Sources sit off-canvas at defaults (separation ≫ the 1920px frame
    // width, so |cx ± separation/2| lands past both edges): only a limited
    // angular slice of each source's circles ever crosses the frame, which
    // is what keeps the fringes reading as open, sweeping S-curves instead
    // of closed rings around a visible centre — see the header comment's
    // "no bullseye" note. Floored well above 0 so the sources can never
    // coincide either: a `separation` of zero would degenerate this into a
    // single source's concentric-circle field — guilloche territory, not
    // this pattern's hyperbola-family identity. The floor is structural,
    // not a runtime clamp.
    { key: 'separation', kind: 'float', min: 200, max: 8000, step: 10, default: 1800, label: 'interference.separation' },
    { key: 'detune', kind: 'float', min: 0, max: 0.5, step: 0.005, default: 0.05, label: 'interference.detune' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 1.5, step: 0.05, default: 0.35, label: 'interference.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.05, max: 1, step: 0.02, default: 0.5, label: 'interference.opacity' },
  ],
  generate(p, seed, size) {
    const linesN = p['lines']!;
    const sourcesN = p['sources']!;
    const freq = p['frequency']!;
    const amp = p['amplitude']!;
    const sep = p['separation']!;
    const detune = p['detune']!;
    const sw = p['strokeWidth']!;
    const op = p['opacity']!;

    const rnd = mulberry32(deriveSeed(seed, 'interference'));
    const cx = size.w / 2, cy = size.h / 2;

    // Sources sit on the horizontal centre line, spaced `separation` apart
    // and centred on x = cx (integer offsets from the mean index), so
    // adjacent sources are always exactly `separation` apart and the
    // arrangement is symmetric about the vertical axis regardless of
    // `sources` — the mirror symmetry the reference shows.
    const sources: { x: number; y: number }[] = [];
    for (let i = 0; i < sourcesN; i++) {
      const offset = i - (sourcesN - 1) / 2;
      sources.push({ x: cx + offset * sep, y: cy });
    }

    // Per-source wavenumber: source 0 carries the reference k = frequency;
    // each further source is detuned up by one more step, so for the
    // two-source case k₂/k₁ = 1 + detune matches the spec's naming exactly.
    const ks = sources.map((_, i) => freq * (1 + detune * i));

    // Per-source initial phase: the only seed-driven quantity. The forced
    // order above (the k's, the symmetric placement) never moves with the
    // seed — only which flourish of fringe crossings you land on does.
    const phi0 = sources.map(() => rnd() * 2 * Math.PI);

    // Phase (all exactly 1-periodic, vanish at wrap). Each source's phase
    // advances by its OWN small integer number of full turns per cycle, so
    // sin(k·r + φᵢ(t)) individually returns to its resting value whenever
    // ph wraps 1→0 — no matter what `detune` did to that source's k. The
    // SUM (and so the whole fringe field) is therefore exactly 1-periodic
    // regardless of detune; this is the "quantise so every source advances
    // an integer number of cycles" guard from the spec, satisfied
    // structurally rather than by snapping `detune` itself. `% 1` makes
    // phase 1 literally phase 0 before the multiply, so the wrap is
    // bit-identical, not just numerically close.
    const ph = (p['phase'] ?? 0) % 1;
    // Rate i+1 per source, derived from the index: a fixed [1, 2, 3] was
    // safe only while `sources` capped at 3 in the param table — one more
    // source would have read undefined and NaN'd every vertex silently.
    const phi = phi0.map((base, i) => base + 2 * Math.PI * (i + 1) * ph);

    const W = size.w - 2 * MARGIN;
    const usableHeight = size.h - 2 * MARGIN;
    const rowSpacing = usableHeight / Math.max(1, linesN - 1);
    const yTop = MARGIN;

    const children: SvgNode[] = [];
    for (let i = 0; i < linesN; i++) {
      const y0 = yTop + i * rowSpacing;
      let d = '';
      for (let s = 0; s <= SAMPLES; s++) {
        const x = MARGIN + (W * s) / SAMPLES;
        let z = 0;
        for (let j = 0; j < sourcesN; j++) {
          const dx = x - sources[j]!.x, dy = y0 - sources[j]!.y;
          const r = Math.hypot(dx, dy);
          z += Math.sin(ks[j]! * r + phi[j]!);
        }
        const y = y0 + z * amp;
        const xr = Math.round(x * 100) / 100;
        const yr = Math.round(y * 100) / 100;
        d += s === 0 ? `M${xr} ${yr}` : `L${xr} ${yr}`;
      }
      children.push(el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': sw, opacity: op }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
