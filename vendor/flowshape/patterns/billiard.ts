import { el, type SvgNode } from '../core/svg';
import { definePattern } from './registry';

const D2R = Math.PI / 180;

export const billiard = definePattern({
  id: 'billiard',
  family: 'curves',
  phase: 1,
  heavy: false,
  usesSeed: false,
  anim: { continuous: ['launch', 'ecc', 'strokeWidth', 'opacity', 'size'], usesPhase: true },
  params: [
    { key: 'ecc', kind: 'float', min: 0.1, max: 0.95, step: 0.01, default: 0.74, label: 'billiard.ecc' },
    { key: 'launch', kind: 'float', min: 4, max: 176, step: 0.5, default: 76, label: 'billiard.launch' },
    { key: 'bounces', kind: 'int', min: 40, max: 800, step: 10, default: 320, label: 'billiard.bounces' },
    { key: 'strokeWidth', kind: 'float', min: 0.1, max: 2, step: 0.05, default: 0.35, label: 'billiard.strokeWidth' },
    { key: 'opacity', kind: 'float', min: 0.05, max: 1, step: 0.01, default: 0.42, label: 'billiard.opacity' },
    { key: 'showEllipse', kind: 'bool', min: 0, max: 1, step: 1, default: 1, label: 'billiard.showEllipse' },
  ],
  generate(p, _seed, size) {
    const cx = size.w / 2, cy = size.h / 2;
    const A = Math.min(size.w, size.h) * 0.46;
    const B = A * Math.sqrt(1 - p['ecc']! * p['ecc']!);
    // Phase carries the launch point once around the rim. The chords all
    // move, but every one of them stays tangent to the same confocal
    // caustic (the billiard's conserved quantity), so what the cycle shows
    // is the invariant curve holding still under a flowing web. `% 1`
    // makes phase 1 literally the phase-0 expression, closing the loop
    // byte-for-byte. The 2.234 offset keeps the default start off the
    // ellipse's vertices, where a 90-degree launch would collapse the
    // orbit onto a single 2-periodic diameter.
    const t0 = 2.234 + ((p['phase'] ?? 0) % 1) * 2 * Math.PI;
    let px = A * Math.cos(t0), py = B * Math.sin(t0);
    // Launch angle is measured from the local tangent, so its meaning is
    // geometric, not directional: near 0 the chords hug the rim (elliptic
    // caustic), near 90 they cross between the foci (hyperbolic caustic).
    const tx = -A * Math.sin(t0), ty = B * Math.cos(t0);
    const tl = Math.hypot(tx, ty);
    const la = p['launch']! * D2R;
    let dx = (tx / tl) * Math.cos(la) - (ty / tl) * Math.sin(la);
    let dy = (tx / tl) * Math.sin(la) + (ty / tl) * Math.cos(la);
    // The rotated tangent may point outward depending on orientation; the
    // chord geometry is mirror-symmetric, so flipping is harmless.
    if ((px * dx) / (A * A) + (py * dy) / (B * B) > 0) { dx = -dx; dy = -dy; }
    let d = `M${(cx + px).toFixed(2)} ${(cy + py).toFixed(2)}`;
    for (let i = 0; i < p['bounces']!; i++) {
      // Ray-ellipse intersection: with the current point on the ellipse one
      // root of the quadratic is s=0, so the exit is s = -2*b1/a2 exactly.
      const a2 = (dx * dx) / (A * A) + (dy * dy) / (B * B);
      const b1 = (px * dx) / (A * A) + (py * dy) / (B * B);
      const s = (-2 * b1) / a2;
      if (!Number.isFinite(s) || s <= 1e-9) break;
      px += s * dx; py += s * dy;
      // Re-project onto the ellipse so floating-point drift cannot
      // accumulate over hundreds of bounces.
      const m = Math.hypot(px / A, py / B);
      px /= m; py /= m;
      d += `L${(cx + px).toFixed(2)} ${(cy + py).toFixed(2)}`;
      // Specular reflection about the inward normal (grad of the ellipse).
      let nx = px / (A * A), ny = py / (B * B);
      const nl = Math.hypot(nx, ny);
      nx /= nl; ny /= nl;
      const dot = dx * nx + dy * ny;
      dx -= 2 * dot * nx; dy -= 2 * dot * ny;
      const dl = Math.hypot(dx, dy);
      dx /= dl; dy /= dl;
    }
    const children: SvgNode[] = [
      el('path', { d, fill: 'none', stroke: 'ink', 'stroke-width': p['strokeWidth']!, opacity: p['opacity']! }),
    ];
    if (p['showEllipse']! === 1) {
      // As a sampled path, not an <ellipse>: the canvas adapter's tag
      // vocabulary doesn't include ellipse, and one more path costs nothing.
      let rim = '';
      for (let i = 0; i <= 256; i++) {
        const a = (2 * Math.PI * i) / 256;
        rim += `${i ? 'L' : 'M'}${(cx + A * Math.cos(a)).toFixed(2)} ${(cy + B * Math.sin(a)).toFixed(2)}`;
      }
      children.push(el('path', { d: rim + 'Z', fill: 'none', stroke: 'ink', 'stroke-width': 1, opacity: 0.5 }));
    }
    return el('svg', { viewBox: `0 0 ${size.w} ${size.h}` }, children);
  },
});
