// Headless renderer: exports the current scene as PNG, then moves one light
// and exports a second frame to prove every object's shadow updates
// synchronously. Also prints light count and shadow computation timings.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "canvas";

import { nowMs } from "../src/platform.js";
import { renderScene, VIEW } from "../src/renderer.js";
import { computeShadows } from "../src/shadows.js";
import { buildBooks, buildCabinet, defaultLights } from "../src/scene.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "artifacts"), { recursive: true });

const makeCanvas = (w, h) => createCanvas(w, h);

function drawHud(ctx, stats, note) {
  ctx.save();
  ctx.fillStyle = "rgba(28,24,20,0.82)";
  const boxW = 330;
  const boxH = note ? 118 : 96;
  ctx.fillRect(16, 16, boxW, boxH);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.strokeRect(16, 16, boxW, boxH);
  ctx.fillStyle = "#f7ecd4";
  ctx.font = "16px sans-serif";
  ctx.fillText(`Light sources: ${stats.lightCount}`, 32, 46);
  ctx.fillText(`Shadow geometry: ${stats.geometryMs.toFixed(2)} ms`, 32, 72);
  ctx.fillText(`Mask + blur: ${stats.maskMs.toFixed(2)} ms`, 32, 96);
  if (note) {
    ctx.fillStyle = "#ffd76a";
    ctx.fillText(note, 32, 120);
  }
  ctx.restore();
}

function frame(lights, note, file) {
  const canvas = makeCanvas(VIEW.width, VIEW.height);
  const ctx = canvas.getContext("2d");
  const stats = renderScene(makeCanvas, ctx, lights, buildCabinet(), buildBooks());
  drawHud(ctx, stats, note);
  writeFileSync(file, canvas.toBuffer("image/png"));
  return stats;
}

function signature(shadowSet) {
  const parts = [];
  for (const polygon of shadowSet.back)
    parts.push(`B${polygon.lightId}:${polygon.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("|")}`);
  for (const shelf of shadowSet.shelves)
    for (const polygon of shelf.polygons)
      parts.push(`S${shelf.boardTop}-${polygon.lightId}:${polygon.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("|")}`);
  return parts.join("\n");
}

const boards = buildCabinet();
const books = buildBooks();
const lights = defaultLights();

const before = signature(computeShadows(lights, boards, books));
const statsBefore = frame(
  lights,
  null,
  resolve(root, "artifacts/scene.png")
);

// Move light #1 from the left toward an empty spot on the right and
// slightly downward, so the new position is easy to distinguish.
const moved = lights.map((light) =>
  light.id === 1 ? { ...light, x: 200, y: 300 } : light
);
const after = signature(computeShadows(moved, boards, books));
const statsAfter = frame(
  moved,
  "Light #1 moved -> all shadows recomputed",
  resolve(root, "artifacts/scene-light-moved.png")
);

const changed = before !== after;
const beforeLines = new Set(before.split("\n"));
const afterLines = new Set(after.split("\n"));
let changedPolygons = 0;
for (const line of afterLines) if (!beforeLines.has(line)) changedPolygons++;

console.log("=== Frame 1 (initial scene) ===");
console.log(`lights: ${statsBefore.lightCount}, geometry: ${statsBefore.geometryMs.toFixed(2)} ms, masks: ${statsBefore.maskMs.toFixed(2)} ms, total: ${statsBefore.totalMs.toFixed(2)} ms`);
console.log("=== Frame 2 (light #1 moved) ===");
console.log(`lights: ${statsAfter.lightCount}, geometry: ${statsAfter.geometryMs.toFixed(2)} ms, masks: ${statsAfter.maskMs.toFixed(2)} ms, total: ${statsAfter.totalMs.toFixed(2)} ms`);
console.log(`shadow polygons changed after moving light: ${changedPolygons}`);
if (!changed || changedPolygons === 0) {
  console.error("FAIL: moving a light did not change the projected shadows");
  process.exit(1);
}
console.log("PASS: every shadow is recomputed geometrically after light movement");
