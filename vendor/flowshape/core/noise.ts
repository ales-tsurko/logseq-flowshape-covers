import { mulberry32 } from './prng';

/** Seeded 2D value noise in [-1, 1] with smoothstep interpolation. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  // Lattice hash: one PRNG stream hashed by cell coords — deterministic, seed-isolated.
  const base = mulberry32(seed)() * 43758.5453 + 17.17;
  const hash = (i: number, j: number): number => {
    const v = Math.sin(i * 127.1 + j * 311.7 + base) * 43758.5453;
    return v - Math.floor(v);
  };
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    let fx = x - i, fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const v =
      hash(i, j) * (1 - fx) * (1 - fy) +
      hash(i + 1, j) * fx * (1 - fy) +
      hash(i, j + 1) * (1 - fx) * fy +
      hash(i + 1, j + 1) * fx * fy;
    return v * 2 - 1;
  };
}

/** Fractional Brownian motion over `octaves` layers of value noise; output in [-1, 1]. */
export function fbm2D(seed: number, octaves: number): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => makeNoise2D(seed + o * 1013));
  let norm = 0;
  for (let o = 0; o < octaves; o++) norm += 1 / 2 ** o;
  return (x, y) => {
    let sum = 0;
    for (let o = 0; o < octaves; o++) {
      const f = 2 ** o;
      sum += layers[o]!(x * f, y * f) / f;
    }
    return sum / norm;
  };
}
