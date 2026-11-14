// Geometric shadow projection.
//
// For every enabled point light and every 3D occluder we cast rays from the
// light through the occluder's 8 box vertices onto each receiver plane
// (the back panel, or a shelf board top). The intersections form a point
// cloud whose convex hull - clipped to the receiver rectangle - is the
// shadow polygon. Nothing here is a pre-baked texture: moving a light or a
// book changes every polygon on the next frame.

import {
  boxVertices,
  clipPolygonRect,
  convexHull,
  rayAxisPlane,
} from "./math-geometry.js";
import { CABINET, project } from "./scene.js";

const EPS = 1e-6;

function projectToPlane(light, vertices, axis, planeCoord, toLocal) {
  const hits = [];
  for (const vertex of vertices) {
    const hit = rayAxisPlane(light, vertex, axis, planeCoord);
    if (hit) hits.push(toLocal(hit));
  }
  if (hits.length < 3) return null;
  return convexHull(hits);
}

// Back panel is the vertical plane z = 0; local 2D coords are world (x, y).
function backPanelShadows(light, casters) {
  const rect = { minX: 0, minY: 0, maxX: CABINET.width, maxY: CABINET.height };
  const polygons = [];
  for (const caster of casters) {
    if (caster.min.z <= EPS) continue; // nothing in front of the panel
    const local = projectToPlane(
      light,
      boxVertices(caster),
      "z",
      0,
      (p) => ({ x: p.x, y: p.y })
    );
    if (!local) continue;
    const clipped = clipPolygonRect(local, rect);
    if (clipped.length >= 3) {
      polygons.push({
        points: clipped.map((p) => project({ x: p.x, y: p.y, z: 0 })),
        alpha: light.intensity,
        lightId: light.id,
      });
    }
  }
  return polygons;
}

// A shelf top is the horizontal plane y = boardTop; local coords are (x, z).
// Only books cast onto shelf tops; boards are skipped so a board cannot
// shadow its own surface.
function shelfTopShadows(light, boardTops, books) {
  const result = [];
  const rect = { minX: 0, minY: 0, maxX: CABINET.width, maxY: CABINET.depth };
  for (const boardTop of boardTops) {
    const polygons = [];
    for (const book of books) {
      if (book.max.y <= boardTop + EPS) continue; // wholly below/at plane
      if (book.min.y < boardTop - EPS) continue; // plane cuts through the book
      const local = projectToPlane(
        light,
        boxVertices(book),
        "y",
        boardTop,
        (p) => ({ x: p.x, y: p.z })
      );
      if (!local) continue;
      const clipped = clipPolygonRect(local, rect);
      if (clipped.length >= 3) {
        polygons.push({
          points: clipped.map((p) => project({ x: p.x, y: boardTop, z: p.y })),
          alpha: light.intensity,
          lightId: light.id,
        });
      }
    }
    result.push({ boardTop, polygons });
  }
  return result;
}

export function computeShadows(lights, boards, books) {
  const enabled = lights.filter((light) => light.on);
  const casters = boards.concat(books);
  const boardTops = boards
    .filter((b) => b.max.y - b.min.y <= CABINET.thickness + EPS) // horizontal boards
    .map((b) => b.max.y);

  const back = [];
  for (const light of enabled) back.push(...backPanelShadows(light, casters));

  const shelves = [];
  for (const light of enabled) {
    const perShelf = shelfTopShadows(light, boardTops, books);
    perShelf.forEach((entry, i) => {
      if (!shelves[i]) shelves[i] = { boardTop: entry.boardTop, polygons: [] };
      shelves[i].polygons.push(...entry.polygons);
    });
  }
  return { back, shelves };
}
