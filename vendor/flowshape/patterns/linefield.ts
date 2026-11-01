import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';
import { mulberry32, deriveSeed } from '../core/prng';
import { fbm2D } from '../core/noise';

/**
 * linefield — vortex line field. A fixed regular grid of short axial strokes
 * (θ ≡ θ+π), each oriented by a continuous vector field
 *
 *     V = V_base + swirl·V_vortex + waviness·V_wave,   θ = atan2(Vy, Vx),
 *
 * evaluated at domain-warped coordinates. The forced order is that every term
 * is the curl of a scalar streamfunction — vortices are curls of Gaussian
 * bumps, each wave is the curl of a plane sinusoid, the base whisper is solid
 * rotation — so V is divergence-free by identity. A divergence-free field has
 * no sources and no sinks: it must circulate, and orientations must vary
 * smoothly from stroke to stroke. Coherence is a theorem, not a tuning.
 * Randomness lives only in the field's parameters (vortex placement, wave
 * phases, warp lattice), never per-stroke — nearby strokes agree because they
 * sample the same field, and the reader can follow a swirl across the frame.
 *
 * Phase (exactly 1-periodic, identity at the wrap — every term below is a
 * sum of sin/cos of integer multiples of 2πph, or vanishes at ph = 0):
 *  - a whole-field angular drift θ += 2πph turns every tick in place — one
 *    turn per cycle, two apparent cycles for axial strokes — so the entire
 *    field is always in motion, not just the wave-dominated corners;
 *  - a shimmer term SHIM·(sin(2πph+2θ)−sin 2θ) modulates that drift's
 *    timing by the local field structure (2θ respects the axial identity),
 *    so the turn sweeps across the swirls as a living wave instead of a
 *    rigid rotor;
 *  - each wave's phase advances by its own small-integer multiple of 2π per
 *    cycle, so the local bending travels through the swirls, and each
 *    wave's amplitude breathes on its own integer-rate envelope
 *    1 + BR·(sin(2π·m·ph+β)−sin β) (identity at the wrap);
 *  - each vortex centre orbits a circle, offset (cos(2πph+ψ)−cosψ,
 *    sin(2πph+ψ)−sinψ)·ρ, which vanishes at ph = 0 — the swirls wander.
 * The grid itself never moves and no stroke appears or disappears; only
 * orientations (and the |V|-driven opacity below) flow. Every phase term
 * vanishes at ph = 0, so the phase-0 still is exactly the approved
 * composition.
 *
 * Degeneracy: where |V| → 0 the angle is undefined and neighbouring strokes
 * would jitter. Two guards, both part of the model: V_base is an ε-strength
 * solid rotation about the frame centre (the vortex law with its falloff
 * removed), so θ is defined everywhere and swirl = waviness = 0 degrades
 * honestly to concentric rings; and stroke opacity is tanh-normalised |V|
 * against the frame's own mean, floored at 25%, so vortex cores breathe dark
 * instead of jittering bright.
 */
export const linefield = definePattern({
  id: 'linefield',
  family: 'fields',
  phase: 1,
  heavy: false,
  usesSeed: true,
  anim: {
    continuous: ['swirl', 'waviness', 'warp', 'strokeLen', 'strokeWidth', 'opacity', 'size'],
    usesPhase: true,
  },
  params: [
    // cells and vortices re-seat the whole composition — chaotic, never routed.
    { key: 'cells', kind: 'int', min: 12, max: 48, step: 1, default: 31, label: 'linefield.cells' },
    { key: 'vortices', kind: 'int', min: 2, max: 9, step: 1, default: 6, label: 'linefield.vortices' },
    { key: 'swirl', kind: 'float', min: 0, max: 2, step: 0.05, default: 1, label: 'linefield.swirl' },
    { key: 'waviness', kind: 'float', min: 0, max: 1, step: 0.02, default: 0.3, label: 'linefield.waviness' },
    { key: 'warp', kind: 'float', min: 0, max: 1, step: 0.02, default: 0.35, label: 'linefield.warp' },
    { key: 'strokeLen', kind: 'float', min: 0.3, max: 1.6, step: 0.05, default: 0.85, label: 'linefield.strokeLen' },
    { key: 'strokeWidth', kind: 'float', min: 0.2, max: 3, step: 0.05, default: 1.1, label: 'linefield.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.1, max: 1, step: 0.02, default: 0.85, label: 'linefield.opacity' },
  ],
  generate(p, seed, size) {
    const ph = (p['phase'] ?? 0) % 1;
    const S = Math.min(size.w, size.h);
    // Field space: frame scaled so the short side is 1 — every field
    // parameter below is resolution-independent.
    const UW = size.w / S, VH = size.h / S;

    // Seed streams: (1) vortex placement/strengths/radii/orbit angles,
    // (2) wave directions/frequencies/phases/rates, (3) the warp lattice.
    const rndV = mulberry32(deriveSeed(seed, 'linefield-vortex'));
    const rndW = mulberry32(deriveSeed(seed, 'linefield-wave'));
    const n1 = fbm2D(deriveSeed(seed, 'linefield-warp-x'), 2);
    const n2 = fbm2D(deriveSeed(seed, 'linefield-warp-y'), 2);

    // Vortices: alternating signs guarantee counter-rotating neighbours (the
    // reference's broad S-curves live between opposite vortices); strength is
    // divided by σ so a wide vortex and a tight one peak at the same speed.
    // Placement is stratified across the width (one jittered slot per vortex)
    // rather than uniform-random: a pure scatter routinely leaves a third of
    // the frame with no vortex in reach, and that dead zone reads as texture,
    // not composition. The slots keep every region within a swirl's pull
    // while the jitter and the free v keep seeds genuinely different.
    const K = p['vortices']!;
    const swirl = p['swirl']!;
    const vort: { u: number; v: number; g: number; s2: number; psi: number }[] = [];
    for (let i = 0; i < K; i++) {
      const u = ((i + 0.5) / K + (rndV() - 0.5) * (0.7 / K)) * UW;
      const v = (0.12 + 0.76 * rndV()) * VH;
      const s = (i % 2 === 0 ? 1 : -1) * (0.7 + 0.6 * rndV());
      const sig = 0.18 + 0.16 * rndV();
      vort.push({ u, v, g: (s * swirl) / sig, s2: 2 * sig * sig, psi: rndV() * 2 * Math.PI });
    }
    const RHO = 0.1; // vortex orbit radius (field units) — wander, not tremble

    // Curl waves: Vx += ky·A·cos(kx·u + ky·v + φ), Vy += −kx·A·cos(…).
    // A = a₀/k equalises the velocity each wave contributes across
    // frequencies. Integer phase rates (±2..4 cycles per loop) are what
    // keep the wrap an identity. Each wave also breathes: its amplitude
    // rides 1 + BR·(sin(2π·m·ph+β)−sin β), m a small integer from its own
    // seed stream (rndB, drawn after the others so phase 0 is untouched) —
    // exactly 1-periodic, identity at ph = 0.
    const NW = 4;
    const lam = p['waviness']!;
    const rndB = mulberry32(deriveSeed(seed, 'linefield-breathe'));
    const BR = 0.5;
    const waves: { kx: number; ky: number; wx: number; wy: number; phi: number }[] = [];
    for (let i = 0; i < NW; i++) {
      const dir = rndW() * 2 * Math.PI;
      const k = 2 * Math.PI * (2 + 3 * rndW());
      const rate = (2 + Math.floor(rndW() * 3)) * (rndW() < 0.5 ? -1 : 1);
      const m = 1 + Math.floor(rndB() * 2);
      const beta = rndB() * 2 * Math.PI;
      const breathe = 1 + BR * (Math.sin(2 * Math.PI * m * ph + beta) - Math.sin(beta));
      const amp = ((lam * 0.22) / k) * breathe;
      const kx = k * Math.cos(dir), ky = k * Math.sin(dir);
      waves.push({ kx, ky, wx: ky * amp, wy: -kx * amp, phi: rndW() * 2 * Math.PI + 2 * Math.PI * rate * ph });
    }

    // Domain warp: coordinates bent through two low-frequency fbm fields
    // before the field is read — the organic bending that keeps vortices
    // from reading as compass circles.
    const WAMP = p['warp']! * 0.16;
    const WF = 1.4;

    const EPS = 0.02; // base whisper: solid rotation about the frame centre
    const cu = UW / 2, cv = VH / 2;

    const field = (u0: number, v0: number): [number, number] => {
      const u = u0 + WAMP * n1(u0 * WF, v0 * WF);
      const v = v0 + WAMP * n2(u0 * WF, v0 * WF);
      let vx = -(v - cv) * EPS;
      let vy = (u - cu) * EPS;
      for (const vo of vort) {
        const du = u - (vo.u + RHO * (Math.cos(2 * Math.PI * ph + vo.psi) - Math.cos(vo.psi)));
        const dv = v - (vo.v + RHO * (Math.sin(2 * Math.PI * ph + vo.psi) - Math.sin(vo.psi)));
        const g = vo.g * Math.exp(-(du * du + dv * dv) / vo.s2);
        vx += -dv * g;
        vy += du * g;
      }
      for (const w of waves) {
        const c = Math.cos(w.kx * u + w.ky * v + w.phi);
        vx += w.wx * c;
        vy += w.wy * c;
      }
      return [vx, vy];
    };

    // Fixed regular grid, centred, cells strokes across the short side.
    const spacing = S / p['cells']!;
    const cols = Math.max(1, Math.round(size.w / spacing));
    const rows = Math.max(1, Math.round(size.h / spacing));
    const sx = size.w / cols, sy = size.h / rows;
    const halfL = (p['strokeLen']! * Math.min(sx, sy)) / 2;

    // First pass: orientation and |V| per grid point, plus the frame's own
    // mean speed — the tanh normaliser below is self-referential, so the
    // opacity design survives any swirl/waviness setting (including the
    // ε-only degenerate corner) without a magic constant.
    // Whole-field angular drift + structure-timed shimmer (see header). The
    // drift leaves |V| — and therefore the opacity map, the visible swirl
    // anatomy — untouched: the composition holds still while every tick in
    // it turns.
    const SPIN = 2 * Math.PI * ph;
    const SHIM = 0.65;
    const n = cols * rows;
    const theta = new Float64Array(n);
    const mag = new Float64Array(n);
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * sx, y = (r + 0.5) * sy;
        const [vx, vy] = field(x / S, y / S);
        const i = r * cols + c;
        const t0 = Math.atan2(vy, vx);
        theta[i] = t0 + SPIN + SHIM * (Math.sin(SPIN + 2 * t0) - Math.sin(2 * t0));
        mag[i] = Math.hypot(vx, vy);
        sum += mag[i]!;
      }
    }
    const mean = sum / n || 1;

    // Opacity ∝ tanh-normalised |V|, floored: cores breathe dark, never
    // vanish (the grid is fixed; nothing may appear or disappear).
    const TN = Math.tanh(1.5);
    const baseOp = p['opacity']!;
    const children: SvgNode[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = (c + 0.5) * sx, y = (r + 0.5) * sy;
        const dx = halfL * Math.cos(theta[i]!), dy = halfL * Math.sin(theta[i]!);
        const t = Math.tanh((1.5 * mag[i]!) / mean) / TN;
        const op = Math.min(1, baseOp * (0.25 + 0.75 * t));
        children.push(el('line', {
          x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy,
          stroke: 'ink',
          'stroke-width': p['strokeWidth']!,
          'stroke-linecap': 'round',
          opacity: Math.round(op * 1000) / 1000,
        }));
      }
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
