// Canvas 2D renderer. Shadow polygons from src/shadows.js are rasterized
// into per-light masks, Gaussian-blurred by the light's softness, and then
// combined with "multiply" so overlapping shadows darken additively and the
// occlusion stays consistent with the 3D geometry.

import { blurChannel } from "./blur.js";
import { nowMs } from "./platform.js";
import { computeShadows } from "./shadows.js";
import { CABINET, LIGHT_Z, project } from "./scene.js";

export const VIEW = { width: 760, height: 720 };
const MASK_SCALE = 0.5; // masks render at half resolution for soft, fast blur

function tracePolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

// Build one blurred grayscale mask for every enabled light. Polygons of the
// same light are merged into a single mask before blurring.
function buildLightMasks(createCanvas, lights, polygonGroups, width, height) {
  const mw = Math.round(width * MASK_SCALE);
  const mh = Math.round(height * MASK_SCALE);
  return lights
    .filter((light) => light.on)
    .map((light) => {
      const mask = createCanvas(mw, mh);
      const ctx = mask.getContext("2d");
      ctx.scale(MASK_SCALE, MASK_SCALE);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#000";
      for (const group of polygonGroups) {
        for (const polygon of group) {
          if (polygon.lightId !== light.id) continue;
          tracePolygon(ctx, polygon.points);
          ctx.fill();
        }
      }
      const image = ctx.getImageData(0, 0, mw, mh);
      // Masks are grayscale, so blurring one channel is enough and ~3x
      // cheaper than a full RGBA convolution.
      blurChannel(image.data, mw, mh, 0, light.softness * MASK_SCALE);
      const px = image.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i + 1] = px[i];
        px[i + 2] = px[i];
      }
      ctx.putImageData(image, 0, 0);
      return { mask, alpha: light.intensity };
    });
}

// Multiply every per-light mask onto the main context. White leaves the
// scene untouched; shadowed regions darken, and stacked masks stack too.
function applyMasks(ctx, masks) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (const { mask, alpha } of masks) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(mask, 0, 0, VIEW.width, VIEW.height);
  }
  ctx.restore();
}

export function renderScene(createCanvas, ctx, lights, boards, books) {
  const t0 = nowMs();
  const shadowSet = computeShadows(lights, boards, books);
  const tGeometry = nowMs() - t0;

  const t1 = nowMs();
  const backMasks = buildLightMasks(
    createCanvas,
    lights,
    shadowSet.back.map((p) => [p]),
    VIEW.width,
    VIEW.height
  );
  const shelfMasks = buildLightMasks(
    createCanvas,
    lights,
    shadowSet.shelves.map((s) => s.polygons),
    VIEW.width,
    VIEW.height
  );
  const tMasks = nowMs() - t1;

  drawBackground(ctx);
  drawBackPanel(ctx);
  applyMasks(ctx, backMasks);
  drawCarcassAndBooks(ctx, boards, books, shadowSet, shelfMasks);
  drawLights(ctx, lights);

  const totalMs = nowMs() - t0;
  return {
    totalMs,
    geometryMs: tGeometry,
    maskMs: tMasks,
    lightCount: lights.filter((l) => l.on).length,
  };
}

function drawBackground(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, VIEW.height);
  gradient.addColorStop(0, "#f4efe6");
  gradient.addColorStop(1, "#e2d8c6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
}

function drawBackPanel(ctx) {
  const a = project({ x: 0, y: 0, z: 0 });
  const b = project({ x: CABINET.width, y: 0, z: 0 });
  const c = project({ x: CABINET.width, y: CABINET.height, z: 0 });
  const d = project({ x: 0, y: CABINET.height, z: 0 });
  ctx.fillStyle = "#c9a877";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fill();
  // Subtle panel wood grain lines.
  ctx.strokeStyle = "rgba(90,60,30,0.12)";
  ctx.lineWidth = 1;
  for (let x = 40; x < CABINET.width; x += 40) {
    const p1 = project({ x, y: 0, z: 0 });
    const p2 = project({ x, y: CABINET.height, z: 0 });
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

export { applyMasks, buildLightMasks, tracePolygon };

const FACES = [
  { name: "top", axis: "y", sign: 1, shade: 1.12 },
  { name: "front", axis: "z", sign: 1, shade: 1.0 },
  { name: "right", axis: "x", sign: 1, shade: 0.82 },
];
// In this projection the viewer sees +z (front), +y (top) and +x (right),
// so only those three faces are ever drawn. Back/bottom/left are culled.

function faceCorners(box, face) {
  const coords = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y], z: [box.min.z, box.max.z] };
  const fixed = face.sign === 1 ? coords[face.axis][1] : coords[face.axis][0];
  const others = ["x", "y", "z"].filter((axis) => axis !== face.axis);
  const [u, v] = others;
  // Cyclic winding around the face: (u0,v0) -> (u1,v0) -> (u1,v1) -> (u0,v1).
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  return ring.map(([iu, iv]) => {
    const point = { x: 0, y: 0, z: 0 };
    point[face.axis] = fixed;
    point[u] = coords[u][iu];
    point[v] = coords[v][iv];
    return point;
  });
}

function shadeColor(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.min(255, Math.round(v * factor));
  return `rgb(${clamp((n >> 16) & 255)},${clamp((n >> 8) & 255)},${clamp(n & 255)})`;
}

function drawBox(ctx, box) {
  for (const face of FACES) {
    const corners = faceCorners(box, face);
    const projected = corners.map(project);
    // Back-face culling using the 2D signed area of the projected face.
    // Under this cabinet projection, viewer-facing windings have positive
    // area; negative/zero area faces point away and are hidden.
    let area = 0;
    for (let i = 0; i < projected.length; i++) {
      const a = projected[i];
      const b = projected[(i + 1) % projected.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (area <= 0) continue;
    ctx.fillStyle = shadeColor(box.color, face.shade);
    tracePolygon(ctx, projected);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Painter's algorithm over every box. The depth key approximates camera
// distance in this oblique projection: lower (+x, +z, -y) means nearer.
function depthKey(box) {
  return box.max.z * 2 + box.max.x - box.min.y * 0.8;
}

function drawCarcassAndBooks(ctx, boards, books, shadowSet, shelfMasks) {
  const horizontalTops = boards
    .filter((b) => b.max.y - b.min.y <= CABINET.thickness + 1)
    .map((b) => b.max.y)
    .sort((a, b) => a - b);

  const boxes = boards
    .concat(books)
    .map((box) => ({ box, key: depthKey(box) }))
    .sort((a, b) => a.key - b.key);

  // Shelf-top shadow polygons are drawn immediately after each horizontal
  // board so they sit on the board's top face but under the books on it.
  for (const { box } of boxes) {
    drawBox(ctx, box);
    if (horizontalTops.includes(box.max.y)) {
      const shelfEntry = shadowSet.shelves.find((s) => s.boardTop === box.max.y);
      if (shelfEntry && shelfEntry.polygons.length) {
        const topFace = faceCorners(box, FACES[0]).map(project);
        ctx.save();
        tracePolygon(ctx, topFace);
        ctx.clip();
        applyMasks(ctx, shelfMasks);
        ctx.restore();
      }
    }
  }
}

function drawLights(ctx, lights) {
  for (const light of lights) {
    const pos = project({ x: light.x, y: light.y, z: light.z ?? LIGHT_Z });
    // Hanging wire.
    const anchor = project({ x: light.x, y: CABINET.height + 40, z: light.z ?? LIGHT_Z });
    ctx.strokeStyle = "rgba(60,50,40,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    ctx.globalAlpha = light.on ? 1 : 0.35;
    const glow = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, 22);
    glow.addColorStop(0, "rgba(255,236,170,0.95)");
    glow.addColorStop(1, "rgba(255,236,170,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = light.on ? "#ffd76a" : "#9a9384";
    ctx.strokeStyle = "#6b5a2e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
