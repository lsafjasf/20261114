// Pure geometry helpers: vectors, ray/plane intersection, convex hull,
// rectangle clipping. No DOM or canvas dependencies, shared by browser/node.

export const v3 = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
};

// A box is { min:{x,y,z}, max:{x,y,z} }.
export function boxVertices(box) {
  const out = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
  return out;
}

// Ray from light position `o` through point `p`. Intersect a plane whose
// normal is axis `axis` at coordinate `planeCoord`. Returns null when the
// ray runs parallel to the plane or points away from it.
export function rayAxisPlane(o, p, axis, planeCoord) {
  const d = v3.sub(p, o);
  const denom = d[axis];
  if (Math.abs(denom) < 1e-9) return null;
  const t = (planeCoord - o[axis]) / denom;
  if (t <= 0) return null;
  return v3.add(o, v3.scale(d, t));
}

// Monotone-chain 2D convex hull. Input/Output: [{x,y}...]
export function convexHull(points) {
  if (points.length <= 1) return points.slice();
  const pts = points
    .map((p) => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = [];
  for (const p of pts) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) unique.push(p);
  }
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Sutherland-Hodgman clipping of a convex polygon against an axis-aligned
// rectangle {minX,minY,maxX,maxY} in 2D.
export function clipPolygonRect(poly, rect) {
  let out = poly.slice();
  // Each edge: [inside test, intersection parameter for crossing it].
  const edges = [
    [(p) => p.x >= rect.minX, (a, b) => (rect.minX - a.x) / (b.x - a.x)],
    [(p) => p.x <= rect.maxX, (a, b) => (rect.maxX - a.x) / (b.x - a.x)],
    [(p) => p.y >= rect.minY, (a, b) => (rect.minY - a.y) / (b.y - a.y)],
    [(p) => p.y <= rect.maxY, (a, b) => (rect.maxY - a.y) / (b.y - a.y)],
  ];
  for (const [inside, tAt] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      const crossPoint = () => {
        const t = tAt(prev, cur);
        return { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      };
      if (curIn) {
        if (!prevIn) out.push(crossPoint());
        out.push(cur);
      } else if (prevIn) {
        out.push(crossPoint());
      }
    }
  }
  return out;
}
