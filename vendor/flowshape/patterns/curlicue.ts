import { el } from '../core/svg';
import { definePattern } from './registry';

/**
 * The curlicue fractal (Berry & Goldberg): a walk of unit steps whose
 * heading turns by 2π·α·n at step n — the partial sums of the theta sum
 * Σ e^{πiαn²}, joined by straight lines. Everything on screen is decided
 * by the continued-fraction personality of the single number α: rationals
 * close into crystals, √2−1 chains seahorse curls, the golden ratio lays
 * uniform lace, π−3 marches for thousands of steps before curling.
 */
export const curlicue = definePattern({
  id: 'curlicue',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['curls', 'swell', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'alpha', kind: 'float', min: 0.001, max: 0.06, step: 0.0005, default: 0.007, label: 'curlicue.alpha' },
    { key: 'curls', kind: 'int', min: 10, max: 120, step: 1, default: 42, label: 'curlicue.curls' },
    { key: 'swell', kind: 'float', min: 0, max: 0.6, step: 0.02, default: 0.4, label: 'curlicue.swell' },
    { key: 'waves', kind: 'int', min: 1, max: 6, step: 1, default: 4, label: 'curlicue.waves' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.55, label: 'curlicue.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.85, label: 'curlicue.opacity' },
  ],
  generate(p, _seed, size) {
    const alpha = p['alpha']!;
    // The walk only shows its spiral hierarchy while α·N stays in a narrow
    // band (roughly 30–100): far below, one bare arc; far above, the curls
    // shrink under a pixel and the figure reads as fuzz. So the second knob
    // is not a raw step count but the curl budget, and N adapts to α —
    // every combination the sliders (or Randomize) can produce is a walk
    // whose structure is actually visible.
    const N = Math.min(40000, Math.round(p['curls']! / alpha));
    const TWO_PI = 2 * Math.PI;
    // Accumulate the walk. The turning angle is built by recurrence with a
    // per-step wrap: computing sin(π·α·n²) directly loses float precision
    // once n² is large, but α·n stays exact to ~1e-12 over this range and
    // the wrap keeps the accumulator small.
    // The geometry NEVER moves. Early motion designs modulated the walk
    // itself (precession, step-length waves) and every one of them read as
    // the whole figure turning, pumping or drifting, because any change to
    // the steps couples into the walk's large-scale drift and moves its
    // extent. What travels instead is light: the chain is drawn in chunks,
    // and a pulse of stroke width and ink density runs down it, each curl
    // glowing up as a crest passes through. The pulse is 1-periodic in the
    // walk coordinate and slides by exactly one period per cycle, so with
    // `% 1` folding phase the loop closes byte-for-byte.
    const ph = (p['phase'] ?? 0) % 1;
    const swell = p['swell']!;
    const waves = p['waves']!;
    const xs = new Float64Array(N + 1);
    const ys = new Float64Array(N + 1);
    let ang = 0, x = 0, y = 0;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (let n = 1; n <= N; n++) {
      ang = (ang + TWO_PI * ((alpha * n) % 1)) % TWO_PI;
      x += Math.cos(ang);
      y += Math.sin(ang);
      xs[n] = x; ys[n] = y;
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
    }
    // The figure rocks: a pendulum sway of up to ~0.8·swell radians, once
    // per cycle (sin(2π·ph) — zero at the wrap, so the loop closes and the
    // still render is unrotated). It is a rock, not a full turn, because a
    // turning bounding box under a per-frame refit is exactly the
    // rotate-and-zoom this pattern already shipped and retired.
    const rockMax = 0.8 * swell;
    const rock = rockMax * Math.sin(TWO_PI * ph);
    const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
    // Fit ONCE to the union of the bounding boxes across the whole rocking
    // range — phase-independent by construction, so the scale never pumps.
    // At swell = 0 the union is the plain box and posters keep full size.
    // Half-extents about the rotation centre, because that centre is pinned
    // to the frame centre when drawing.
    let uHalfX = 0, uHalfY = 0;
    for (let s = 0; s <= 4; s++) {
      const a = -rockMax + (rockMax * 2 * s) / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let n = 0; n <= N; n++) {
        const dx = xs[n]! - mx, dy = ys[n]! - my;
        uHalfX = Math.max(uHalfX, Math.abs(dx * ca - dy * sa));
        uHalfY = Math.max(uHalfY, Math.abs(dx * sa + dy * ca));
      }
    }
    const scale = Math.min(
      (size.w * 0.43) / Math.max(uHalfX, 1e-9),
      (size.h * 0.43) / Math.max(uHalfY, 1e-9),
    );
    const cr = Math.cos(rock), sr = Math.sin(rock);
    // A radial ripple travels outward through the figure: each point is
    // displaced along its own radius from the frame centre by a few pixels
    // of travelling sine. Unlike any modulation of the walk's steps (which
    // couples into the global drift and pumps the whole figure), this
    // displacement is bounded by `amp` everywhere, so the figure holds its
    // place while a visible wave washes through the curls. amp scales with
    // swell, so swell = 0 is perfectly still.
    const cxF = size.w / 2, cyF = size.h / 2;
    const amp = 18 * swell;
    const lam = 0.4 * Math.min(size.w, size.h);
    const pt = (n: number): string => {
      const bx = xs[n]! - mx, by = ys[n]! - my;
      const dx = (bx * cr - by * sr) * scale, dy = (bx * sr + by * cr) * scale;
      const r = Math.hypot(dx, dy);
      const rip = amp * Math.sin(TWO_PI * (r / lam - ph));
      const f = r > 1e-9 ? 1 + rip / r : 1;
      return `${(cxF + dx * f).toFixed(2)} ${(cyF + dy * f).toFixed(2)}`;
    };
    const chunks = Math.min(120, Math.max(1, Math.floor(N / 4)));
    const children = [];
    for (let c = 0; c < chunks; c++) {
      const a = Math.floor((c * N) / chunks);
      const b = Math.floor(((c + 1) * N) / chunks);
      let d = `M${pt(a)}`;
      for (let n = a + 1; n <= b; n++) d += `L${pt(n)}`;
      // Cubed cosine crest: narrow bright pulses with long quiet troughs,
      // so the eye reads beads of energy travelling, not a global blink.
      const v = (c + 0.5) / chunks;
      const crest = (0.5 * (1 + Math.cos(TWO_PI * (waves * v - ph)))) ** 3;
      const w = p['strokeWidth']! * (1 + 6 * swell * crest);
      const op = p['opacity']! * (1 - 0.9 * swell * (1 - crest));
      children.push(el('path', {
        d, fill: 'none', stroke: 'ink',
        'stroke-width': Math.round(w * 1000) / 1000,
        opacity: Math.round(op * 1000) / 1000,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
