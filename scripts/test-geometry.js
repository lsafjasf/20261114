// Lightweight assertions over the geometric shadow pipeline. No test
// framework dependency; exits non-zero on the first failure.

import {
  clipPolygonRect,
  convexHull,
  rayAxisPlane,
} from "../src/math-geometry.js";
import { computeShadows } from "../src/shadows.js";
import { buildBooks, buildCabinet, defaultLights } from "../src/scene.js";

let failures = 0;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// Ray from (0,0,10) through (0,0,5) hits z=0 at t=2 -> (0,0,0).
const hit = rayAxisPlane({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 5 }, "z", 0);
assert(hit && hit.z === 0 && hit.x === 0, "ray/back-plane intersection is exact");

const parallel = rayAxisPlane({ x: 0, y: 0, z: 10 }, { x: 1, y: 0, z: 10 }, "z", 0);
assert(parallel === null, "parallel ray returns no intersection");

const hull = convexHull([
  { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 },
  { x: 0, y: 4 }, { x: 2, y: 2 },
]);
assert(hull.length === 4, "convex hull drops interior points");

const clipped = clipPolygonRect(
  [
    { x: -5, y: -5 }, { x: 5, y: -5 },
    { x: 5, y: 5 }, { x: -5, y: 5 },
  ],
  { minX: 0, minY: 0, maxX: 3, maxY: 3 }
);
assert(
  clipped.length === 4 && clipped.every((p) => p.x >= 0 && p.x <= 3 && p.y >= 0 && p.y <= 3),
  "polygon clipping stays inside the receiver rectangle"
);

const boards = buildCabinet();
const books = buildBooks();
const lights = defaultLights();
const base = computeShadows(lights, boards, books);

const topShelf = Math.max(...base.shelves.map((s) => s.boardTop));
assert(
  base.back.length > 0 &&
    base.shelves
      .filter((s) => s.boardTop < topShelf)
      .every((s) => s.polygons.length > 0),
  "back panel and every occupied shelf top receive shadow polygons"
);
assert(
  base.back.every((p) => p.points.length >= 3 && p.lightId > 0),
  "shadow polygons carry their source light id"
);

// Moving any single light must change that light's projected polygons.
for (const target of lights) {
  const moved = lights.map((light) =>
    light.id === target.id ? { ...light, x: light.x + 90, y: light.y - 40 } : light
  );
  const next = computeShadows(moved, boards, books);
  const beforeIds = base.back.filter((p) => p.lightId === target.id).map((p) => JSON.stringify(p.points));
  const afterIds = next.back.filter((p) => p.lightId === target.id).map((p) => JSON.stringify(p.points));
  assert(JSON.stringify(beforeIds) !== JSON.stringify(afterIds),
    `moving light #${target.id} recomputes its back-panel shadows`);
}

// A light directly behind a book (same x, low z) should cast a wider
// shadow than a far-forward light, i.e. geometry responds to light depth.
const book = books[0];
const nearLight = [{ id: 9, x: (book.min.x + book.max.x) / 2, y: book.max.y + 30, z: book.max.z + 8, softness: 0, intensity: 0.3, on: true }];
const farLight = [{ id: 9, x: (book.min.x + book.max.x) / 2, y: book.max.y + 30, z: 400, softness: 0, intensity: 0.3, on: true }];
const span = (set) => {
  const points = set.back.filter((p) => p.lightId === 9).flatMap((p) => p.points);
  const xs = points.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
};
assert(span(computeShadows(nearLight, boards, books)) > span(computeShadows(farLight, boards, books)),
  "closer light casts a wider projected shadow (depth-dependent geometry)");

// Moving a book must move its shadow too - occluders are real geometry.
const movedBooks = books.map((b, i) => (i === 0 ? { ...b, min: { ...b.min, x: b.min.x + 25 }, max: { ...b.max, x: b.max.x + 25 } } : b));
assert(
  JSON.stringify(computeShadows(lights, boards, movedBooks).back) !== JSON.stringify(base.back),
  "moving a book moves the resulting shadows"
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll geometry assertions passed");
