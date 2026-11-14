// Bookshelf scene definition and the cabinet (oblique) projection used to
// map 3D world coordinates onto the 2D canvas.
//
// World coordinates: x = left -> right, y = bottom -> top,
// z = back panel (0) -> viewer (cabinet depth).

export const CABINET = {
  width: 480,
  height: 520,
  depth: 150,
  thickness: 14,
};

export const PROJECTION = {
  scale: 1,
  // Oblique cabinet projection: depth recedes up-right.
  depthX: 0.55,
  depthY: -0.32,
  originX: 120,
  originY: 620,
};

export function project(p) {
  const { scale, depthX, depthY, originX, originY } = PROJECTION;
  return {
    x: originX + (p.x + p.z * depthX) * scale,
    y: originY - (p.y + p.z * depthY) * scale,
  };
}

// Inverse projection for a point on the back panel (z = 0). Used when the
// user drags a light with the pointer.
export function unprojectBack(screen) {
  const { scale, originX, originY } = PROJECTION;
  return {
    x: (screen.x - originX) / scale,
    y: (originY - screen.y) / scale,
  };
}

function box(min, max, color) {
  return { min, max, color };
}

// Shelf boards and the two side panels. Every board is a real 3D occluder,
// so it casts geometric shadows like the books do.
export function buildCabinet() {
  const t = CABINET.thickness;
  const w = CABINET.width;
  const h = CABINET.height;
  const d = CABINET.depth;
  const boards = [];
  for (const level of [0, 172, 344, h]) {
    boards.push(
      box(
        { x: 0, y: level, z: 0 },
        { x: w, y: level + t, z: d },
        "#8a5a33"
      )
    );
  }
  // Side panels.
  boards.push(box({ x: 0, y: 0, z: 0 }, { x: t, y: h, z: d }, "#7d4f2c"));
  boards.push(box({ x: w - t, y: 0, z: 0 }, { x: w, y: h, z: d }, "#7d4f2c"));
  return boards;
}

// Books standing on three shelf levels. Stored as 3D boxes so they occlude
// light and shadow each other and the boards consistently.
export function buildBooks() {
  const t = CABINET.thickness;
  const palette = [
    "#b0433b", "#3f6f9e", "#c98a2e", "#4f7d52", "#7a5a92",
    "#a8633c", "#357b7b", "#944463", "#5a6b3b",
  ];
  const rows = [
    { base: t, heights: [110, 96, 124, 84, 102, 90], widths: [34, 40, 28, 44, 36, 30] },
    { base: 172 + t, heights: [88, 116, 78, 104, 92, 120, 70], widths: [38, 30, 44, 32, 40, 28, 36] },
    { base: 344 + t, heights: [100, 82, 112, 94], widths: [46, 34, 40, 52] },
  ];
  const books = [];
  rows.forEach((row, r) => {
    let x = t + 18;
    row.heights.forEach((height, i) => {
      const width = row.widths[i];
      const zBack = 26 + ((i + r) % 3) * 8;
      const depth = 84;
      books.push(
        box(
          { x, y: row.base, z: zBack },
          { x: x + width, y: row.base + height, z: zBack + depth },
          palette[(i + r * 3) % palette.length]
        )
      );
      x += width + 6;
    });
  });
  return books;
}

// Lights hang in front of the cabinet (depth runs 0..CABINET.depth).
// Keeping them well forward keeps the projected penumbra readable.
export const LIGHT_Z = 330;

export function defaultLights() {
  return [
    { id: 1, x: 110, y: 480, z: LIGHT_Z, softness: 10, intensity: 0.32, on: true },
    { id: 2, x: 250, y: 510, z: LIGHT_Z, softness: 22, intensity: 0.28, on: true },
    { id: 3, x: 210, y: 470, z: LIGHT_Z, softness: 6, intensity: 0.3, on: true },
  ];
}
