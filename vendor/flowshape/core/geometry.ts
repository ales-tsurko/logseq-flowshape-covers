export type Pt = [number, number];

/** Bowyer-Watson Delaunay triangulation. Returns triangles as index triples into pts. */
export function delaunay(pts: Pt[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  // Super-triangle far outside any realistic canvas.
  const P: Pt[] = [...pts, [-1e5, -1e5], [3e5, -1e5], [-1e5, 3e5]];
  let tris: [number, number, number][] = [[n, n + 1, n + 2]];

  const circum = (t: [number, number, number]): [number, number, number] => {
    const [a, b, c] = [P[t[0]]!, P[t[1]]!, P[t[2]]!];
    const [ax, ay] = a, [bx, by] = b, [cx, cy] = c;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return [ux, uy, (ux - ax) ** 2 + (uy - ay) ** 2];
  };

  for (let i = 0; i < n; i++) {
    const p = P[i]!;
    const bad = new Set<number>();
    const edges: [number, number][] = [];
    tris.forEach((t, ti) => {
      const cc = circum(t);
      if ((p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 < cc[2]) {
        bad.add(ti);
        edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
      }
    });
    tris = tris.filter((_, ti) => !bad.has(ti));
    const count = new Map<string, number>();
    const key = (e: [number, number]) => `${Math.min(e[0], e[1])}_${Math.max(e[0], e[1])}`;
    for (const e of edges) count.set(key(e), (count.get(key(e)) ?? 0) + 1);
    for (const e of edges) if (count.get(key(e)) === 1) tris.push([e[0], e[1], i]);
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

/** Voronoi cell of sites[i] by half-plane clipping against the k nearest sites. */
export function voronoiCell(sites: Pt[], i: number, bounds: Pt[], k = 24): Pt[] {
  const s = sites[i]!;
  let poly = bounds;
  const others = sites
    .map((p, j) => [j, (p[0] - s[0]) ** 2 + (p[1] - s[1]) ** 2] as [number, number])
    .filter(([j]) => j !== i)
    .sort((a, b) => a[1] - b[1])
    .slice(0, k);
  for (const [j] of others) {
    if (poly.length === 0) break;
    const o = sites[j]!;
    const mx = (s[0] + o[0]) / 2, my = (s[1] + o[1]) / 2;
    const nx = o[0] - s[0], ny = o[1] - s[1];
    const next: Pt[] = [];
    for (let q = 0; q < poly.length; q++) {
      const a = poly[q]!, b = poly[(q + 1) % poly.length]!;
      const da = (a[0] - mx) * nx + (a[1] - my) * ny;
      const db = (b[0] - mx) * nx + (b[1] - my) * ny;
      if (da <= 0) next.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = next;
  }
  return poly;
}

export function centroid(poly: Pt[]): Pt {
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  return poly.length ? [cx / poly.length, cy / poly.length] : [0, 0];
}
