import {
  GRID_SIZE,
  MAX_ELEVATION_M,
  BASE_LEVEL,
  PROFILE_SAMPLES,
  createTerrain,
  cloneTerrain,
  applyBrush,
  buildSection,
  faultCrossings,
  sampleHeight,
  validateSection,
  terrainBounds,
  heightMeters,
  pushHistory,
} from "./terrain.js";

const PRESET_IDS = ["canyon", "mesa", "fault"];
const PRESET_NAMES = {
  canyon: "风蚀峡谷",
  mesa: "层岩台地",
  fault: "断层崖",
};
const TOOL_NAMES = {
  raise: "抬升",
  lower: "压低",
  carve: "削切",
  smooth: "平滑",
};

const stageCanvas = document.querySelector("#stageCanvas");
const stageShell = document.querySelector("#canvasShell");
const profileCanvas = document.querySelector("#profileCanvas");
const ctx = stageCanvas.getContext("2d");
const profileCtx = profileCanvas.getContext("2d");

const dom = {
  toolButtons: [...document.querySelectorAll(".tool-button")],
  brushSize: document.querySelector("#brushSize"),
  brushSizeLabel: document.querySelector("#brushSizeLabel"),
  brushCursor: document.querySelector("#brushCursor"),
  cutPosition: document.querySelector("#cutPosition"),
  cutValue: document.querySelector("#cutValue"),
  cutReadout: document.querySelector("#cutReadout"),
  waterLevel: document.querySelector("#waterLevel"),
  waterValue: document.querySelector("#waterValue"),
  layerList: document.querySelector("#layerList"),
  presetList: document.querySelector("#presetList"),
  profileElevation: document.querySelector("#profileElevation"),
  sectionPin: document.querySelector("#sectionPin"),
  syncChip: document.querySelector("#syncChip"),
  syncLabel: document.querySelector("#syncLabel"),
  exportButton: document.querySelector("#exportButton"),
  undoButton: document.querySelector("#undoButton"),
  resetButton: document.querySelector("#resetButton"),
  editState: document.querySelector("#editState"),
  gridStatus: document.querySelector("#gridStatus"),
  heightStatus: document.querySelector("#heightStatus"),
  profileStatus: document.querySelector("#profileStatus"),
  seedStatus: document.querySelector("#seedStatus"),
  toast: document.querySelector("#toast"),
};

const state = {
  terrain: createTerrain("canyon"),
  presetId: "canyon",
  tool: "raise",
  brushSize: 38,
  hover: null,
  editing: false,
  lastEditTime: 0,
  lastEditPoint: null,
  history: [],
  renderQueued: false,
  profileQueued: false,
  syncQueued: false,
  syncTimer: null,
  toastTimer: null,
  colorEditing: false,
  texturePattern: null,
  view: null,
  frame: 0,
};
state.history.push(cloneTerrain(state.terrain));

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function shadeRgb(rgb, factor, warmth = 0) {
  return [
    Math.round(clamp(rgb[0] * factor + warmth, 0, 255)),
    Math.round(clamp(rgb[1] * factor, 0, 255)),
    Math.round(clamp(rgb[2] * factor, 0, 255)),
  ];
}

function rgbString(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function resizeCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height, dpr };
}

function makeView(width, height) {
  const isoX = Math.min(width * 0.345, height * 0.57);
  const isoY = Math.min(width * 0.105, height * 0.155);
  const zScale = Math.min(width * 0.28, height * 0.33);
  const cut = state.terrain.cutPosition;
  const bounds = terrainBounds(state.terrain);
  const relativeTop = -(bounds.max * zScale);
  const relativeBottom = (1 + cut) * isoY - BASE_LEVEL * zScale;
  const verticalCenter = (relativeTop + relativeBottom) / 2;
  const originX = width * 0.5;
  const originY = height * 0.51 - verticalCenter;
  const project = (x, y, z) => ({
    x: originX + (x - y) * isoX,
    y: originY + (x + y) * isoY - z * zScale,
  });
  return {
    width,
    height,
    isoX,
    isoY,
    zScale,
    originX,
    originY,
    cut,
    project,
    cutRow: cut * (GRID_SIZE - 1),
  };
}

function createTexturePattern() {
  const tile = document.createElement("canvas");
  tile.width = 48;
  tile.height = 48;
  const tctx = tile.getContext("2d");
  tctx.fillStyle = "rgba(24, 26, 21, 0.4)";
  let seed = 81;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967295;
  };
  for (let index = 0; index < 80; index += 1) {
    const x = random() * 48;
    const y = random() * 48;
    const radius = random() < 0.75 ? 0.45 : 0.9;
    tctx.globalAlpha = 0.14 + random() * 0.32;
    tctx.beginPath();
    tctx.arc(x, y, radius, 0, Math.PI * 2);
    tctx.fill();
  }
  tctx.globalAlpha = 0.12;
  tctx.strokeStyle = "rgba(255, 242, 212, 0.8)";
  tctx.lineWidth = 0.5;
  for (let row = 0; row < 8; row += 1) {
    const y = row * 6 + random() * 3;
    tctx.beginPath();
    tctx.moveTo(0, y);
    tctx.bezierCurveTo(12, y - 1.5, 31, y + 1.5, 48, y - 0.5);
    tctx.stroke();
  }
  return ctx.createPattern(tile, "repeat");
}

function requestRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    drawScene();
  });
}

function requestProfile() {
  if (state.profileQueued) return;
  state.profileQueued = true;
  requestAnimationFrame(() => {
    state.profileQueued = false;
    drawProfile();
  });
}

function scheduleSyncCheck() {
  window.clearTimeout(state.syncTimer);
  state.syncTimer = window.setTimeout(runSyncCheck, 260);
}

function drawPolygon(context, points, fill, stroke = null, lineWidth = 1) {
  if (points.length < 2) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.closePath();
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.stroke();
  }
}

function drawBackground(view) {
  const gradient = ctx.createLinearGradient(0, 0, view.width, view.height);
  gradient.addColorStop(0, "#eeeade");
  gradient.addColorStop(0.52, "#e4dfd0");
  gradient.addColorStop(1, "#dcd5c5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);

  const glow = ctx.createRadialGradient(
    view.width * 0.52,
    view.height * 0.42,
    20,
    view.width * 0.52,
    view.height * 0.42,
    view.width * 0.58,
  );
  glow.addColorStop(0, "rgba(255, 252, 240, 0.42)");
  glow.addColorStop(1, "rgba(255, 252, 240, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.save();
  ctx.strokeStyle = "rgba(54, 62, 54, 0.055)";
  ctx.lineWidth = 0.6;
  const spacing = 28;
  for (let x = spacing; x < view.width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, view.height);
    ctx.stroke();
  }
  for (let y = spacing; y < view.height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(view.width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(104, 112, 92, 0.09)";
  ctx.lineWidth = 0.8;
  for (let index = 0; index < 4; index += 1) {
    ctx.beginPath();
    ctx.ellipse(
      view.width * 0.12,
      view.height * 0.74,
      view.width * (0.12 + index * 0.045),
      view.height * (0.06 + index * 0.022),
      -0.22,
      0.15,
      Math.PI * 1.74,
    );
    ctx.stroke();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    view.width * 0.5,
    view.height * 0.48,
    view.height * 0.25,
    view.width * 0.5,
    view.height * 0.48,
    view.width * 0.72,
  );
  vignette.addColorStop(0, "rgba(48, 52, 43, 0)");
  vignette.addColorStop(1, "rgba(48, 52, 43, 0.1)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.save();
  ctx.strokeStyle = "rgba(30, 40, 37, 0.2)";
  ctx.lineWidth = 1;
  const margin = 13;
  const tick = 6;
  const corners = [
    [margin, margin, 1, 1],
    [view.width - margin, margin, -1, 1],
    [margin, view.height - margin, 1, -1],
    [view.width - margin, view.height - margin, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * tick, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * tick);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTray(view) {
  const { project, cut } = view;
  const lip = 0.055;
  const depth = 0.025;
  const frontLeft = project(-lip, cut + lip, BASE_LEVEL);
  const frontRight = project(1 + lip, cut + lip, BASE_LEVEL);
  const backLeft = project(-lip, -lip, BASE_LEVEL);
  const backRight = project(1 + lip, -lip, BASE_LEVEL);
  const frontLeftLow = project(-lip, cut + lip, BASE_LEVEL - depth);
  const frontRightLow = project(1 + lip, cut + lip, BASE_LEVEL - depth);
  const sideRightLow = project(1 + lip, -lip, BASE_LEVEL - depth);

  ctx.save();
  ctx.filter = "blur(14px)";
  ctx.fillStyle = "rgba(52, 45, 31, 0.19)";
  const shadow = [backLeft, backRight, frontRight, frontLeft].map((point) => ({
    x: point.x + 12,
    y: point.y + 23,
  }));
  drawPolygon(ctx, shadow, "rgba(52, 45, 31, 0.2)");
  ctx.restore();

  drawPolygon(
    ctx,
    [frontLeft, frontRight, frontRightLow, frontLeftLow],
    "#ad9672",
    "rgba(61, 52, 38, 0.22)",
    1,
  );
  drawPolygon(
    ctx,
    [frontRight, backRight, sideRightLow, frontRightLow],
    "#9d8663",
    "rgba(61, 52, 38, 0.2)",
    1,
  );
  drawPolygon(
    ctx,
    [backLeft, backRight, frontRight, frontLeft],
    "#d5c29e",
    "rgba(74, 63, 43, 0.28)",
    1,
  );
  drawPolygon(
    ctx,
    [project(0, 0, BASE_LEVEL), project(1, 0, BASE_LEVEL), project(1, cut, BASE_LEVEL), project(0, cut, BASE_LEVEL)],
    "rgba(92, 77, 53, 0.17)",
    "rgba(67, 56, 38, 0.28)",
    1,
  );

  ctx.save();
  ctx.strokeStyle = "rgba(82, 67, 43, 0.34)";
  ctx.fillStyle = "rgba(82, 67, 43, 0.56)";
  ctx.lineWidth = 1;
  ctx.font = '7px "SFMono-Regular", monospace';
  ctx.textAlign = "center";
  for (let index = 0; index <= 8; index += 1) {
    const t = index / 8;
    const x = lerp(-lip, 1 + lip, t);
    const point = project(x, cut + lip, BASE_LEVEL);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y + 2);
    ctx.lineTo(point.x, point.y + (index % 2 === 0 ? 8 : 5));
    ctx.stroke();
  }
  const labelStart = project(0.06, cut + lip, BASE_LEVEL);
  const labelEnd = project(0.94, cut + lip, BASE_LEVEL);
  ctx.fillText("S A N D B O X   ·   10 m", (labelStart.x + labelEnd.x) / 2, labelEnd.y + 18);
  ctx.restore();
}

function surfaceColor(height, light) {
  const low = [101, 117, 97];
  const mid = [159, 150, 111];
  const high = [210, 188, 143];
  const crest = [194, 166, 127];
  let rgb;
  if (height < 0.48) {
    rgb = mixRgb(low, mid, clamp(height / 0.48));
  } else {
    rgb = mixRgb(mid, high, clamp((height - 0.48) / 0.34));
  }
  if (height > 0.78) rgb = mixRgb(rgb, crest, clamp((height - 0.78) / 0.16) * 0.4);
  const shade = 0.73 + clamp(light, 0, 1) * 0.4;
  return shadeRgb(rgb, shade, Math.max(0, light) * 9);
}

function drawSurfaceQuad(row, col, rowEnd, endY, view, strip = false) {
  const terrain = state.terrain;
  const points = [];
  if (!strip) {
    const nodes = [
      [col, row],
      [col + 1, row],
      [col + 1, row + 1],
      [col, row + 1],
    ];
    for (const [xIndex, yIndex] of nodes) {
      const x = xIndex / (GRID_SIZE - 1);
      const y = yIndex / (GRID_SIZE - 1);
      const height = terrain.heights[yIndex * GRID_SIZE + xIndex];
      points.push(view.project(x, y, height));
    }
    const h00 = terrain.heights[row * GRID_SIZE + col];
    const h10 = terrain.heights[row * GRID_SIZE + col + 1];
    const h01 = terrain.heights[(row + 1) * GRID_SIZE + col];
    const h11 = terrain.heights[(row + 1) * GRID_SIZE + col + 1];
    const avg = (h00 + h10 + h01 + h11) / 4;
    const nx = -(h10 - h00 + h11 - h01) * 13;
    const ny = -(h01 - h00 + h11 - h10) * 13;
    const length = Math.sqrt(nx * nx + ny * ny + 1);
    const light = ((nx * -0.54) + (ny * -0.38) + 0.76) / (length * 0.98);
    const fill = surfaceColor(avg, light);
    drawPolygon(ctx, points, rgbString(fill), rgbString(fill), 0.65);
  } else {
    const x0 = col / (GRID_SIZE - 1);
    const x1 = (col + 1) / (GRID_SIZE - 1);
    const y0 = rowEnd / (GRID_SIZE - 1);
    const h00 = sampleHeight(terrain, x0, y0);
    const h10 = sampleHeight(terrain, x1, y0);
    const h01 = sampleHeight(terrain, x0, endY);
    const h11 = sampleHeight(terrain, x1, endY);
    points.push(view.project(x0, y0, h00));
    points.push(view.project(x1, y0, h10));
    points.push(view.project(x1, endY, h11));
    points.push(view.project(x0, endY, h01));
    const avg = (h00 + h10 + h01 + h11) / 4;
    const nx = -(h10 - h00 + h11 - h01) * 13;
    const ny = -(h01 - h00 + h11 - h10) * 13;
    const length = Math.sqrt(nx * nx + ny * ny + 1);
    const light = ((nx * -0.54) + (ny * -0.38) + 0.76) / (length * 0.98);
    const fill = surfaceColor(avg, light);
    drawPolygon(ctx, points, rgbString(fill), rgbString(fill), 0.65);
  }
}

function drawSurface(view) {
  const cutRow = view.cutRow;
  const lastRow = Math.floor(cutRow);
  for (let row = 0; row < lastRow; row += 1) {
    for (let col = 0; col < GRID_SIZE - 1; col += 1) {
      drawSurfaceQuad(row, col, lastRow, view.cut, view, false);
    }
  }
  const cutY = view.cut;
  const gridY = lastRow / (GRID_SIZE - 1);
  if (cutY > gridY + 0.00001) {
    for (let col = 0; col < GRID_SIZE - 1; col += 1) {
      drawSurfaceQuad(lastRow, col, lastRow, cutY, view, true);
    }
  }
  drawSurfaceGrid(view);
}

function drawSurfaceGrid(view) {
  const terrain = state.terrain;
  const lastRow = Math.floor(view.cutRow);
  const cutY = view.cut;
  ctx.save();
  ctx.lineWidth = 0.55;
  ctx.strokeStyle = "rgba(255, 250, 232, 0.2)";
  for (let col = 4; col < GRID_SIZE - 1; col += 4) {
    ctx.beginPath();
    for (let row = 0; row <= lastRow; row += 1) {
      const x = col / (GRID_SIZE - 1);
      const y = row / (GRID_SIZE - 1);
      const point = view.project(x, y, terrain.heights[row * GRID_SIZE + col]);
      if (row === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    const end = view.project(col / (GRID_SIZE - 1), cutY, sampleHeight(terrain, col / (GRID_SIZE - 1), cutY));
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  for (let row = 4; row <= lastRow; row += 4) {
    ctx.beginPath();
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const x = col / (GRID_SIZE - 1);
      const y = row / (GRID_SIZE - 1);
      const point = view.project(x, y, terrain.heights[row * GRID_SIZE + col]);
      if (col === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function cellCorners(row, col, yEnd, terrain) {
  const x0 = col / (GRID_SIZE - 1);
  const x1 = (col + 1) / (GRID_SIZE - 1);
  const y0 = row / (GRID_SIZE - 1);
  return [
    { x: x0, y: y0, h: sampleHeight(terrain, x0, y0) },
    { x: x1, y: y0, h: sampleHeight(terrain, x1, y0) },
    { x: x1, y: yEnd, h: sampleHeight(terrain, x1, yEnd) },
    { x: x0, y: yEnd, h: sampleHeight(terrain, x0, yEnd) },
  ];
}

function eachVisibleCell(view, callback) {
  const lastRow = Math.floor(view.cutRow);
  for (let row = 0; row < lastRow; row += 1) {
    const yEnd = (row + 1) / (GRID_SIZE - 1);
    for (let col = 0; col < GRID_SIZE - 1; col += 1) {
      callback(row, col, yEnd);
    }
  }
  const gridY = lastRow / (GRID_SIZE - 1);
  if (view.cut > gridY + 0.00001) {
    for (let col = 0; col < GRID_SIZE - 1; col += 1) {
      callback(lastRow, col, view.cut);
    }
  }
}

function drawContours(view) {
  const terrain = state.terrain;
  const bounds = terrainBounds(terrain);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const steps = Math.round(1 / (5 / MAX_ELEVATION_M));
  for (let step = 1; step < steps; step += 1) {
    const level = step / steps;
    if (level < bounds.min + 0.01 || level > bounds.max - 0.01) continue;
    const major = step % 3 === 0;
    ctx.beginPath();
    eachVisibleCell(view, (row, col, yEnd) => {
      const corners = cellCorners(row, col, yEnd, terrain);
      const crossings = [];
      for (let edge = 0; edge < 4; edge += 1) {
        const a = corners[edge];
        const b = corners[(edge + 1) % 4];
        if ((a.h < level && b.h >= level) || (a.h >= level && b.h < level)) {
          const t = (level - a.h) / (b.h - a.h);
          crossings.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
        }
      }
      if (crossings.length >= 2) {
        const first = view.project(crossings[0].x, crossings[0].y, level);
        const second = view.project(crossings[1].x, crossings[1].y, level);
        ctx.moveTo(first.x, first.y);
        ctx.lineTo(second.x, second.y);
        if (crossings.length === 4) {
          const third = view.project(crossings[2].x, crossings[2].y, level);
          const fourth = view.project(crossings[3].x, crossings[3].y, level);
          ctx.moveTo(third.x, third.y);
          ctx.lineTo(fourth.x, fourth.y);
        }
      }
    });
    ctx.strokeStyle = major ? "rgba(73, 62, 35, 0.48)" : "rgba(83, 72, 43, 0.29)";
    ctx.lineWidth = major ? 0.95 : 0.62;
    ctx.stroke();
  }
  ctx.restore();
}

function drawWater(view) {
  const terrain = state.terrain;
  const level = terrain.waterLevel;
  const subdivision = 3;
  const resolution = (GRID_SIZE - 1) * subdivision + 1;
  const cols = resolution - 1;
  const step = 1 / cols;
  const rowMax = Math.floor(view.cut * cols);
  const mask = new Uint8Array((rowMax + 2) * cols);
  const path = new Path2D();
  let waterCells = 0;

  for (let row = 0; row <= rowMax; row += 1) {
    const y0 = row * step;
    if (y0 >= view.cut) break;
    const y1 = Math.min((row + 1) * step, view.cut);
    for (let col = 0; col < cols; col += 1) {
      const x0 = col * step;
      const x1 = (col + 1) * step;
      const h00 = sampleHeight(terrain, x0, y0);
      const h10 = sampleHeight(terrain, x1, y0);
      const h11 = sampleHeight(terrain, x1, y1);
      const h01 = sampleHeight(terrain, x0, y1);
      if (h00 >= level - 0.001 || h10 >= level - 0.001
        || h11 >= level - 0.001 || h01 >= level - 0.001) continue;
      mask[row * cols + col] = 1;
      waterCells += 1;
      const p0 = view.project(x0, y0, level);
      const p1 = view.project(x1, y0, level);
      const p2 = view.project(x1, y1, level);
      const p3 = view.project(x0, y1, level);
      path.moveTo(p0.x, p0.y);
      path.lineTo(p1.x, p1.y);
      path.lineTo(p2.x, p2.y);
      path.lineTo(p3.x, p3.y);
      path.closePath();
    }
  }
  if (!waterCells) return;

  ctx.save();
  ctx.fillStyle = "rgba(62, 132, 153, 0.56)";
  ctx.fill(path);
  ctx.clip(path);
  ctx.strokeStyle = "rgba(213, 241, 244, 0.28)";
  ctx.lineWidth = 0.7;
  for (let y = view.originY + view.isoY * view.cut * 0.5; y < view.height; y += 8) {
    ctx.beginPath();
    for (let x = 0; x < view.width; x += 12) {
      ctx.moveTo(x, y + Math.sin(x * 0.045 + y) * 1.2);
      ctx.lineTo(x + 6, y + Math.sin(x * 0.045 + y) * 1.2);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(228, 248, 247, 0.58)";
  ctx.lineWidth = 0.7;
  for (let row = 0; row <= rowMax; row += 1) {
    const y0 = row * step;
    if (y0 >= view.cut) break;
    const y1 = Math.min((row + 1) * step, view.cut);
    for (let col = 0; col < cols; col += 1) {
      if (!mask[row * cols + col]) continue;
      const coords = [
        [col * step, y0],
        [(col + 1) * step, y0],
        [(col + 1) * step, y1],
        [col * step, y1],
      ];
      const neighborChecks = [
        { row: row - 1, col, edge: [0, 1] },
        { row: row + 1, col, edge: [2, 3] },
        { row, col: col - 1, edge: [3, 0] },
        { row, col: col + 1, edge: [1, 2] },
      ];
      for (const neighbor of neighborChecks) {
        const inside = neighbor.row >= 0 && neighbor.col >= 0 && neighbor.col < cols
          && neighbor.row <= rowMax
          && mask[neighbor.row * cols + neighbor.col];
        if (inside) continue;
        const start = coords[neighbor.edge[0]];
        const end = coords[neighbor.edge[1]];
        const p0 = view.project(start[0], start[1], level);
        const p1 = view.project(end[0], end[1], level);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawRightWall(view) {
  const terrain = state.terrain;
  const rows = [];
  const lastRow = Math.floor(view.cutRow);
  for (let row = 0; row <= lastRow; row += 1) {
    rows.push({
      y: row / (GRID_SIZE - 1),
      h: terrain.heights[row * GRID_SIZE + GRID_SIZE - 1],
    });
  }
  if (view.cut > rows[rows.length - 1].y + 0.00001) {
    rows.push({ y: view.cut, h: sampleHeight(terrain, 1, view.cut) });
  }

  ctx.save();
  for (let index = 0; index < rows.length - 1; index += 1) {
    const first = rows[index];
    const second = rows[index + 1];
    for (const layer of terrain.layers) {
      const aTop = Math.min(first.h, layer.from);
      const bTop = Math.min(second.h, layer.from);
      const aBottom = layer.to;
      const bBottom = layer.to;
      if (aTop <= aBottom && bTop <= bBottom) continue;
      const points = [
        view.project(1, first.y, aTop),
        view.project(1, second.y, bTop),
        view.project(1, second.y, bBottom),
        view.project(1, first.y, aBottom),
      ];
      const base = hexToRgb(layer.color);
      const color = shadeRgb(base, 0.72 - index * 0.001);
      drawPolygon(ctx, points, rgbString(color), rgbString(color), 0.5);
    }
  }
  const face = [
    ...rows.map((row) => view.project(1, row.y, row.h)),
    ...rows.slice().reverse().map((row) => view.project(1, row.y, BASE_LEVEL)),
  ];
  ctx.save();
  drawPolygon(ctx, face, null);
  ctx.clip();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = state.texturePattern;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.restore();
  ctx.strokeStyle = "rgba(20, 28, 25, 0.34)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const point = view.project(1, row.y, row.h);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawSectionFace(view) {
  const terrain = state.terrain;
  const section = buildSection(terrain, view.cut);
  const points = section.points;
  const project = (x, z) => view.project(x, view.cut, z);
  ctx.save();

  for (const layer of terrain.layers) {
    const baseRgb = hexToRgb(layer.color);
    const fill = rgbString(shadeRgb(baseRgb, 0.93));
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 0.55;
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index];
      const second = points[index + 1];
      const aTop = Math.min(first.top, layer.from + first.throwValue);
      const bTop = Math.min(second.top, layer.from + second.throwValue);
      const aBottom = layer.to + first.throwValue;
      const bBottom = layer.to + second.throwValue;
      if (aTop <= aBottom && bTop <= bBottom) continue;
      const quad = [
        project(first.x, aTop),
        project(second.x, bTop),
        project(second.x, bBottom),
        project(first.x, aBottom),
      ];
      drawPolygon(ctx, quad, fill, fill, 0.55);
    }
  }

  const facePath = new Path2D();
  const topProjects = points.map((point) => project(point.x, point.top));
  const baseStart = project(0, BASE_LEVEL);
  const baseEnd = project(1, BASE_LEVEL);
  facePath.moveTo(topProjects[0].x, topProjects[0].y);
  for (let index = 1; index < topProjects.length; index += 1) {
    facePath.lineTo(topProjects[index].x, topProjects[index].y);
  }
  facePath.lineTo(baseEnd.x, baseEnd.y);
  facePath.lineTo(baseStart.x, baseStart.y);
  facePath.closePath();

  const faceStart = project(0, 0.8);
  const faceEnd = project(1, -0.05);
  const minX = Math.min(faceStart.x, faceEnd.x) - 30;
  const maxX = Math.max(faceStart.x, faceEnd.x) + 30;
  const minY = Math.min(faceStart.y, project(0, -0.05).y) - 20;
  const maxY = Math.max(faceStart.y, faceEnd.y) + 80;

  ctx.save();
  ctx.clip(facePath);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = state.texturePattern;
  ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "rgba(255, 245, 218, 0.9)";
  ctx.lineWidth = 0.7;
  for (let y = minY; y < maxY; y += 8) {
    ctx.beginPath();
    ctx.moveTo(minX, y);
    for (let x = minX; x < maxX; x += 18) {
      ctx.lineTo(x, y + Math.sin(x * 0.06 + y * 0.12) * 1.1);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(24, 29, 24, 0.9)";
  for (let y = minY + 13; y < maxY; y += 29) {
    ctx.beginPath();
    ctx.moveTo(minX, y);
    for (let x = minX; x < maxX; x += 24) {
      ctx.lineTo(x, y + Math.sin(x * 0.035 + y) * 2.4);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(31, 36, 29, 0.34)";
  ctx.lineWidth = 0.75;
  for (const boundary of terrain.layers.slice(0, -1).map((layer) => layer.to)) {
    ctx.beginPath();
    let drawing = false;
    for (const point of points) {
      const z = boundary + point.throwValue;
      if (point.top <= z + 0.002) {
        drawing = false;
        continue;
      }
      const next = project(point.x, z);
      if (!drawing) {
        ctx.moveTo(next.x, next.y);
        drawing = true;
      } else {
        ctx.lineTo(next.x, next.y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(65, 139, 158, 0.66)";
  ctx.strokeStyle = "rgba(208, 238, 240, 0.54)";
  ctx.lineWidth = 0.7;
  for (let index = 0; index < points.length - 1; index += 1) {
    const first = points[index];
    const second = points[index + 1];
    if (first.top >= terrain.waterLevel && second.top >= terrain.waterLevel) continue;
    const quad = [
      project(first.x, first.top + 0.001),
      project(second.x, second.top + 0.001),
      project(second.x, terrain.waterLevel),
      project(first.x, terrain.waterLevel),
    ];
    drawPolygon(ctx, quad, "rgba(65, 139, 158, 0.56)", "rgba(208, 238, 240, 0.2)", 0.4);
  }
  ctx.restore();

  ctx.save();
  for (const crossing of section.crossings) {
    const nearby = points.reduce((best, point) => (
      Math.abs(point.x - crossing.x) < Math.abs(best.x - crossing.x) ? point : best
    ), points[0]);
    const top = project(crossing.x, nearby.top);
    const bottom = project(crossing.x, BASE_LEVEL);
    ctx.strokeStyle = "rgba(31, 29, 23, 0.46)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let index = 0; index <= 12; index += 1) {
      const t = index / 12;
      const x = lerp(top.x, bottom.x, t) + Math.sin(t * 19 + crossing.index) * 2.1;
      const y = lerp(top.y, bottom.y, t);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = "#c4603b";
    ctx.lineWidth = 1.35;
    ctx.stroke();
    const labelX = top.x + 7;
    const labelY = top.y + 18;
    ctx.fillStyle = "rgba(249, 246, 237, 0.88)";
    ctx.fillRect(labelX, labelY - 8, 18, 12);
    ctx.fillStyle = "#a84d31";
    ctx.font = '7px "SFMono-Regular", monospace';
    ctx.fillText(`F${crossing.index + 1}`, labelX + 3, labelY + 1);
  }
  ctx.restore();

  const topLine = new Path2D();
  topProjects.forEach((point, index) => {
    if (index === 0) topLine.moveTo(point.x, point.y);
    else topLine.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "rgba(45, 54, 46, 0.92)";
  ctx.lineWidth = 1.4;
  ctx.stroke(topLine);
  ctx.strokeStyle = "rgba(185, 90, 55, 0.8)";
  ctx.lineWidth = 0.55;
  ctx.stroke(topLine);

  ctx.strokeStyle = "rgba(31, 38, 31, 0.17)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(baseStart.x, baseStart.y);
  ctx.lineTo(baseEnd.x, baseEnd.y);
  ctx.stroke();

  ctx.fillStyle = "rgba(38, 46, 39, 0.64)";
  ctx.font = '8px "SFMono-Regular", monospace';
  const labelA = topProjects[0];
  const labelB = topProjects[topProjects.length - 1];
  ctx.fillText("A", labelA.x + 4, labelA.y - 8);
  ctx.textAlign = "right";
  ctx.fillText("A′", labelB.x - 4, labelB.y - 8);
  ctx.textAlign = "left";
  const faceLabel = project(0.54, BASE_LEVEL + 0.018);
  ctx.fillStyle = "rgba(249, 246, 237, 0.6)";
  ctx.fillRect(faceLabel.x - 4, faceLabel.y - 9, 77, 13);
  ctx.fillStyle = "rgba(35, 42, 35, 0.6)";
  ctx.font = '6px "SFMono-Regular", monospace';
  ctx.fillText("LIVE SECTION · A—A′", faceLabel.x, faceLabel.y + 1);
  ctx.restore();
  return section;
}

function drawProfile() {
  const size = resizeCanvas(profileCanvas, profileCtx);
  profileCtx.clearRect(0, 0, size.width, size.height);
  if (size.width < 20 || size.height < 20) return;
  const terrain = state.terrain;
  const section = buildSection(terrain, terrain.cutPosition);
  const padX = 7;
  const topPad = 8;
  const baseline = size.height - 7;
  const maxHeight = 0.94;
  const usableWidth = size.width - padX * 2;
  const usableHeight = baseline - topPad;
  const xAt = (x) => padX + x * usableWidth;
  const yAt = (z) => baseline - ((z - BASE_LEVEL) / (maxHeight - BASE_LEVEL)) * usableHeight;

  profileCtx.save();
  for (const layer of terrain.layers) {
    const base = hexToRgb(layer.color);
    const fill = rgbString(shadeRgb(base, 0.98));
    profileCtx.fillStyle = fill;
    profileCtx.strokeStyle = fill;
    profileCtx.lineWidth = 0.35;
    for (let index = 0; index < section.points.length - 1; index += 1) {
      const first = section.points[index];
      const second = section.points[index + 1];
      const aTop = Math.min(first.top, layer.from + first.throwValue);
      const bTop = Math.min(second.top, layer.from + second.throwValue);
      const aBottom = layer.to + first.throwValue;
      const bBottom = layer.to + second.throwValue;
      if (aTop <= aBottom && bTop <= bBottom) continue;
      profileCtx.beginPath();
      profileCtx.moveTo(xAt(first.x), yAt(aTop));
      profileCtx.lineTo(xAt(second.x), yAt(bTop));
      profileCtx.lineTo(xAt(second.x), yAt(bBottom));
      profileCtx.lineTo(xAt(first.x), yAt(aBottom));
      profileCtx.closePath();
      profileCtx.fill();
    }
  }

  profileCtx.strokeStyle = "rgba(30, 37, 30, 0.24)";
  profileCtx.lineWidth = 0.5;
  for (const boundary of terrain.layers.slice(0, -1).map((layer) => layer.to)) {
    profileCtx.beginPath();
    let drawing = false;
    section.points.forEach((point) => {
      const z = boundary + point.throwValue;
      if (point.top <= z + 0.001) {
        drawing = false;
        return;
      }
      const x = xAt(point.x);
      const y = yAt(z);
      if (!drawing) {
        profileCtx.moveTo(x, y);
        drawing = true;
      } else {
        profileCtx.lineTo(x, y);
      }
    });
    profileCtx.stroke();
  }

  profileCtx.fillStyle = "rgba(62, 137, 159, 0.72)";
  for (let index = 0; index < section.points.length - 1; index += 1) {
    const first = section.points[index];
    const second = section.points[index + 1];
    if (first.top >= terrain.waterLevel && second.top >= terrain.waterLevel) continue;
    profileCtx.beginPath();
    profileCtx.moveTo(xAt(first.x), yAt(first.top));
    profileCtx.lineTo(xAt(second.x), yAt(second.top));
    profileCtx.lineTo(xAt(second.x), yAt(terrain.waterLevel));
    profileCtx.lineTo(xAt(first.x), yAt(terrain.waterLevel));
    profileCtx.closePath();
    profileCtx.fill();
  }

  profileCtx.beginPath();
  section.points.forEach((point, index) => {
    const x = xAt(point.x);
    const y = yAt(point.top);
    if (index === 0) profileCtx.moveTo(x, y);
    else profileCtx.lineTo(x, y);
  });
  profileCtx.strokeStyle = "rgba(39, 47, 39, 0.86)";
  profileCtx.lineWidth = 1.1;
  profileCtx.stroke();

  for (const crossing of section.crossings) {
    const x = xAt(crossing.x);
    profileCtx.strokeStyle = "#b85a38";
    profileCtx.lineWidth = 1;
    profileCtx.beginPath();
    profileCtx.moveTo(x + 1.5, topPad);
    profileCtx.lineTo(x - 1.5, baseline);
    profileCtx.stroke();
  }
  profileCtx.restore();

  const maxElevation = Math.round(heightMeters(section.maxTop));
  dom.profileElevation.textContent = `+${maxElevation} m`;
}

function sectionSignature(section) {
  return section.points.map((point) => Math.round(point.top * 10000) / 10000);
}

function runSyncCheck(notify = false) {
  window.clearTimeout(state.syncTimer);
  const current = validateSection(state.terrain, state.terrain.cutPosition);
  const otherId = PRESET_IDS.find((id) => id !== state.presetId) ?? "fault";
  const otherTerrain = createTerrain(otherId);
  const comparison = validateSection(otherTerrain, otherTerrain.cutPosition);
  const currentSection = buildSection(state.terrain, state.terrain.cutPosition);
  const comparisonSection = buildSection(otherTerrain, otherTerrain.cutPosition);
  const signatures = [sectionSignature(currentSection), sectionSignature(comparisonSection)];
  const terrainDifference = signatures[0].reduce(
    (largest, value, index) => Math.max(largest, Math.abs(value - signatures[1][index])),
    0,
  );
  const passed = current.valid && comparison.valid
    && current.samples === PROFILE_SAMPLES
    && comparison.samples === PROFILE_SAMPLES
    && terrainDifference > 0.01;
  const result = {
    passed,
    checks: [current, comparison],
    samplesPerSection: PROFILE_SAMPLES,
    terrainDifference,
    maximumError: Math.max(current.maxError, comparison.maxError),
    comparedPresets: [state.presetId, otherId],
  };
  state.lastSyncCheck = result;
  dom.syncChip.classList.toggle("is-error", !passed);
  dom.syncLabel.textContent = passed ? "剖面同步 2/2" : "剖面待复核";
  dom.syncChip.title = passed
    ? `已校验 ${state.presetId} 与 ${otherId} 两套地形：${PROFILE_SAMPLES} 个剖面点均与网格采样一致`
    : "剖面采样校验未通过";
  if (notify) {
    showToast(passed ? "两套不同地形的剖面实算结果一致" : "剖面校验未通过，请检查地形数据");
  }
  return result;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 2200);
}

function drawScene() {
  const size = resizeCanvas(stageCanvas, ctx);
  if (!state.texturePattern) state.texturePattern = createTexturePattern();
  state.frame += 1;
  const view = makeView(size.width, size.height);
  state.view = view;
  ctx.clearRect(0, 0, size.width, size.height);
  drawBackground(view);
  drawTray(view);
  drawRightWall(view);
  drawSurface(view);
  drawContours(view);
  drawWater(view);
  drawSectionFace(view);
  drawSceneAnnotations(view);
}

function drawSceneAnnotations(view) {
  const terrain = state.terrain;
  const pinHeight = sampleHeight(terrain, 0.095, view.cut);
  const pinPoint = view.project(0.095, view.cut, pinHeight);
  dom.sectionPin.style.left = `${Math.round(pinPoint.x)}px`;
  dom.sectionPin.style.top = `${Math.round(pinPoint.y)}px`;

  const bounds = terrainBounds(terrain);
  dom.heightStatus.textContent = `${bounds.minMeters}—${bounds.maxMeters} m`;
  dom.gridStatus.textContent = `${GRID_SIZE} × ${GRID_SIZE}`;
  dom.profileStatus.textContent = String(PROFILE_SAMPLES);
}

function brushRadiusNormal(view = state.view) {
  if (!view) return 0.09;
  return clamp((state.brushSize / 2) / view.isoX, 0.035, 0.18);
}

function nearestTerrainPoint(clientX, clientY) {
  const view = state.view;
  if (!view) return null;
  const rect = stageCanvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const terrain = state.terrain;
  const lastRow = Math.floor(view.cutRow);
  let best = null;
  let bestDistance = Infinity;
  for (let row = 0; row <= lastRow; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const x = col / (GRID_SIZE - 1);
      const y = row / (GRID_SIZE - 1);
      const height = terrain.heights[row * GRID_SIZE + col];
      const screen = view.project(x, y, height);
      const dx = screen.x - localX;
      const dy = screen.y - localY;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y, screen, distance: Math.sqrt(distance) };
      }
    }
  }
  const threshold = Math.max(44, state.brushSize * 0.9);
  return best && best.distance <= threshold ? best : null;
}

function updateCursor(hit) {
  state.hover = hit;
  if (!hit) {
    dom.brushCursor.hidden = true;
    return;
  }
  const view = state.view;
  const diameter = Math.round(brushRadiusNormal(view) * (GRID_SIZE - 1) * view.isoX * 0.92);
  dom.brushCursor.hidden = false;
  dom.brushCursor.style.left = `${Math.round(hit.screen.x)}px`;
  dom.brushCursor.style.top = `${Math.round(hit.screen.y)}px`;
  dom.brushCursor.style.width = `${diameter}px`;
  dom.brushCursor.style.height = `${diameter}px`;
  dom.brushCursor.style.marginLeft = `${-diameter / 2}px`;
  dom.brushCursor.style.marginTop = `${-diameter / 2}px`;
}

function setRangeProgress(input, value) {
  const min = Number(input.min);
  const max = Number(input.max);
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-progress", `${percent}%`);
}

function updateControlsFromTerrain() {
  const terrain = state.terrain;
  dom.cutPosition.value = String(Math.round(terrain.cutPosition * 100));
  dom.cutValue.textContent = `${Math.round(terrain.cutPosition * 100)}%`;
  dom.cutReadout.textContent = `A—A′ · ${terrain.cutPosition.toFixed(2)}`;
  setRangeProgress(dom.cutPosition, Number(dom.cutPosition.value));
  dom.waterLevel.value = String(Math.round(terrain.waterLevel * MAX_ELEVATION_M));
  dom.waterValue.textContent = `${Math.round(terrain.waterLevel * MAX_ELEVATION_M)} m`;
  setRangeProgress(dom.waterLevel, Number(dom.waterLevel.value));
  dom.seedStatus.textContent = `SEED / ${state.presetId.toUpperCase()}-${terrain.seed}`;
  dom.undoButton.disabled = state.history.length <= 1;
  dom.undoButton.style.opacity = state.history.length <= 1 ? "0.35" : "1";
  drawLayers();
  drawPresets();
}

function drawLayers() {
  dom.layerList.innerHTML = "";
  state.terrain.layers.forEach((layer, index) => {
    const row = document.createElement("div");
    row.className = "layer-row";
    row.innerHTML = `
      <span class="layer-drag" aria-hidden="true"></span>
      <span class="layer-name">
        <strong>${layer.name}</strong>
        <small>L${String(index + 1).padStart(2, "0")} · STRATUM</small>
      </span>
      <span class="layer-depth">${Math.round(layer.from * MAX_ELEVATION_M)}—${Math.round(layer.to * MAX_ELEVATION_M)} m</span>
      <label class="color-control" style="--layer-color:${layer.color}" title="修改${layer.name}颜色">
        <input type="color" value="${layer.color}" aria-label="${layer.name}颜色" />
      </label>
    `;
    const input = row.querySelector("input");
    input.addEventListener("input", (event) => {
      if (!state.colorEditing) {
        state.history.push(cloneTerrain(state.terrain));
        if (state.history.length > 24) state.history.shift();
        state.colorEditing = true;
      }
      layer.color = event.target.value;
      row.querySelector(".color-control").style.setProperty("--layer-color", layer.color);
      requestRender();
      requestProfile();
    });
    input.addEventListener("change", () => {
      state.colorEditing = false;
      updateControlsFromTerrain();
    });
    dom.layerList.appendChild(row);
  });
}

const PRESET_THUMBS = {
  canyon: {
    profile: "M2 23 L12 17 L20 19 L28 9 L35 12 L39 24 L44 27 L50 19 L58 8 L66 13 L73 7 L88 16 V33 H2Z",
    top: "M2 23 L12 17 L20 19 L28 9 L35 12 L39 24 L44 27 L50 19 L58 8 L66 13 L73 7 L88 16",
  },
  mesa: {
    profile: "M2 24 L14 21 L22 15 L38 15 L42 10 L66 10 L70 15 L86 17 V33 H2Z",
    top: "M2 24 L14 21 L22 15 L38 15 L42 10 L66 10 L70 15 L86 17",
  },
  fault: {
    profile: "M2 22 L18 18 L31 10 L38 12 L40 6 L48 7 L48 18 L54 20 L55 9 L65 5 L72 9 L88 14 V33 H2Z",
    top: "M2 22 L18 18 L31 10 L38 12 L40 6 L48 7 L48 18 L54 20 L55 9 L65 5 L72 9 L88 14",
  },
};

function presetThumbSvg(id, active) {
  const thumb = PRESET_THUMBS[id];
  const palette = createTerrain(id).layers.map((layer) => layer.color);
  const layerLines = [9, 15, 21, 27].map((y, index) => `
    <path d="M2 ${y} H88" stroke="${palette[index]}" stroke-width="5" stroke-opacity="${active ? 0.85 : 0.68}" />
  `).join("");
  return `
    <svg viewBox="0 0 90 34" preserveAspectRatio="none" aria-hidden="true">
      <rect width="90" height="34" fill="#eee9db" />
      ${layerLines}
      <path d="${thumb.profile}" fill="${palette[0]}" fill-opacity="${active ? 0.36 : 0.18}" />
      <path d="${thumb.top}" fill="none" stroke="${active ? "#a95132" : "#4d5850"}" stroke-width="1.2" />
      ${id === "fault" ? '<path d="M48 5 L48 31" stroke="#b85a38" stroke-width="1" stroke-dasharray="2 2" />' : ""}
    </svg>
  `;
}

function drawPresets() {
  dom.presetList.innerHTML = "";
  for (const id of PRESET_IDS) {
    const info = {
      canyon: ["风蚀峡谷", "CANYON / 04"],
      mesa: ["层岩台地", "MESA / 09"],
      fault: ["断层崖", "RIFT / 17"],
    }[id];
    const active = state.presetId === id;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `preset-card${active ? " is-active" : ""}`;
    card.dataset.preset = id;
    card.innerHTML = `
      ${presetThumbSvg(id, active)}
      <strong>${info[0]}</strong>
      <small>${info[1]}</small>
      <span class="preset-check" aria-hidden="true"></span>
    `;
    card.addEventListener("click", () => selectPreset(id));
    dom.presetList.appendChild(card);
  }
}

function applySnapshot(snapshot) {
  state.terrain = cloneTerrain(snapshot);
  state.presetId = state.terrain.presetId;
  updateControlsFromTerrain();
  requestRender();
  requestProfile();
  scheduleSyncCheck();
}

function selectPreset(id) {
  if (id === state.presetId && state.history.length === 1) return;
  state.terrain = createTerrain(id);
  state.presetId = id;
  state.history = [cloneTerrain(state.terrain)];
  state.hover = null;
  updateControlsFromTerrain();
  requestRender();
  requestProfile();
  scheduleSyncCheck();
  dom.editState.textContent = "预设已载入";
  showToast(`已载入「${PRESET_NAMES[id]}」`);
}

function resetCurrentTerrain() {
  state.terrain = createTerrain(state.presetId);
  state.history = [cloneTerrain(state.terrain)];
  state.hover = null;
  updateControlsFromTerrain();
  requestRender();
  requestProfile();
  scheduleSyncCheck();
  dom.editState.textContent = "已重置";
  showToast("当前预设已恢复到初始地形");
}

function undoEdit() {
  if (state.history.length <= 1) return;
  const snapshot = state.history.pop();
  state.terrain = cloneTerrain(snapshot);
  state.presetId = state.terrain.presetId;
  updateControlsFromTerrain();
  requestRender();
  requestProfile();
  scheduleSyncCheck();
  dom.editState.textContent = "已撤销一步";
}

function drawRoundedRect(context, x, y, width, height, radius, fill, stroke = null) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  }
}

function exportPng() {
  dom.exportButton.disabled = true;
  const stageWidth = stageCanvas.width;
  const stageHeight = stageCanvas.height;
  const exportWidth = 1600;
  const gutter = 48;
  const stageDrawWidth = exportWidth - gutter * 2;
  const stageDrawHeight = Math.round(stageDrawWidth * (stageHeight / stageWidth));
  const headerHeight = 106;
  const footerHeight = 224;
  const exportHeight = headerHeight + stageDrawHeight + footerHeight + gutter;
  const output = document.createElement("canvas");
  output.width = exportWidth;
  output.height = exportHeight;
  const exportCtx = output.getContext("2d");
  const paperGradient = exportCtx.createLinearGradient(0, 0, exportWidth, exportHeight);
  paperGradient.addColorStop(0, "#efebe1");
  paperGradient.addColorStop(0.62, "#e8e3d6");
  paperGradient.addColorStop(1, "#ddd7c7");
  exportCtx.fillStyle = paperGradient;
  exportCtx.fillRect(0, 0, exportWidth, exportHeight);

  exportCtx.strokeStyle = "rgba(30,40,37,0.15)";
  exportCtx.lineWidth = 1;
  exportCtx.beginPath();
  exportCtx.moveTo(gutter, 78);
  exportCtx.lineTo(exportWidth - gutter, 78);
  exportCtx.stroke();

  exportCtx.fillStyle = "#1e2825";
  exportCtx.fillRect(gutter, 31, 36, 30);
  exportCtx.strokeStyle = "rgba(246,243,234,0.8)";
  exportCtx.lineWidth = 2;
  for (let index = 0; index < 3; index += 1) {
    exportCtx.beginPath();
    exportCtx.moveTo(gutter + 8, 40 + index * 8);
    exportCtx.lineTo(gutter + 28 - index * 7, 40 + index * 8);
    exportCtx.stroke();
  }
  exportCtx.fillStyle = "#1e2825";
  exportCtx.font = '700 22px "Arial Narrow", "Aptos", sans-serif';
  exportCtx.fillText("STRATA / LAB", gutter + 48, 52);
  exportCtx.fillStyle = "#6e776f";
  exportCtx.font = '10px "SFMono-Regular", "Strata SC", monospace';
  exportCtx.fillText("SANDBOX TERRAIN STUDY · 山体剖面沙盘", gutter + 48, 67);

  exportCtx.textAlign = "right";
  exportCtx.fillStyle = "#1e2825";
  exportCtx.font = '600 15px "Aptos", "Segoe UI", "Strata SC", sans-serif';
  exportCtx.fillText(PRESET_NAMES[state.presetId], exportWidth - gutter, 50);
  exportCtx.fillStyle = "#7a827b";
  exportCtx.font = '9px "SFMono-Regular", monospace';
  const date = new Date();
  const dateText = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  exportCtx.fillText(`PLATE 0142 · ${dateText} · SEED ${state.terrain.seed}`, exportWidth - gutter, 67);
  exportCtx.textAlign = "left";

  const imageY = headerHeight;
  exportCtx.save();
  exportCtx.shadowColor = "rgba(40,44,35,0.16)";
  exportCtx.shadowBlur = 26;
  exportCtx.shadowOffsetY = 12;
  drawRoundedRect(exportCtx, gutter, imageY, stageDrawWidth, stageDrawHeight, 10, "#e5dfd0");
  exportCtx.restore();
  exportCtx.save();
  drawRoundedRect(exportCtx, gutter, imageY, stageDrawWidth, stageDrawHeight, 10, "#e5dfd0");
  exportCtx.clip();
  exportCtx.drawImage(stageCanvas, gutter, imageY, stageDrawWidth, stageDrawHeight);
  exportCtx.restore();
  exportCtx.strokeStyle = "rgba(30,40,37,0.16)";
  exportCtx.lineWidth = 1;
  drawRoundedRect(exportCtx, gutter, imageY, stageDrawWidth, stageDrawHeight, 10, null, "rgba(30,40,37,0.16)");

  const footerY = imageY + stageDrawHeight + 24;
  const footerX = gutter;
  const footerWidth = exportWidth - gutter * 2;
  drawRoundedRect(exportCtx, footerX, footerY, footerWidth, footerHeight - 24, 9, "rgba(249,247,239,0.68)", "rgba(30,40,37,0.12)");

  exportCtx.fillStyle = "#6f7870";
  exportCtx.font = '8px "SFMono-Regular", monospace';
  exportCtx.fillText("SECTION A—A′ / CURRENT CUT", footerX + 18, footerY + 23);
  exportCtx.fillStyle = "#1e2825";
  exportCtx.font = '600 17px "Iowan Old Style", "Songti SC", "Strata SC", Georgia, serif';
  exportCtx.fillText("地形与剖面同步记录", footerX + 18, footerY + 48);

  const bounds = terrainBounds(state.terrain);
  const metadata = [
    ["CUT", `${Math.round(state.terrain.cutPosition * 100)}%`],
    ["WATER", `${Math.round(state.terrain.waterLevel * MAX_ELEVATION_M)} m`],
    ["ELEV.", `${bounds.minMeters}—${bounds.maxMeters} m`],
    ["MESH", `${GRID_SIZE} × ${GRID_SIZE}`],
  ];
  metadata.forEach(([label, value], index) => {
    const x = footerX + 18 + index * 112;
    exportCtx.fillStyle = "#899088";
    exportCtx.font = '7px "SFMono-Regular", monospace';
    exportCtx.fillText(label, x, footerY + 72);
    exportCtx.fillStyle = "#28332e";
    exportCtx.font = '600 12px "SFMono-Regular", monospace';
    exportCtx.fillText(value, x, footerY + 88);
  });

  state.terrain.layers.forEach((layer, index) => {
    const x = footerX + 18 + index * 112;
    exportCtx.fillStyle = layer.color;
    exportCtx.fillRect(x, footerY + 109, 15, 15);
    exportCtx.fillStyle = "#34403a";
    exportCtx.font = '600 9px "Aptos", "Strata SC", sans-serif';
    exportCtx.fillText(layer.name, x + 22, footerY + 114);
    exportCtx.fillStyle = "#92988f";
    exportCtx.font = '6px "SFMono-Regular", monospace';
    exportCtx.fillText(`L${String(index + 1).padStart(2, "0")}`, x + 22, footerY + 123);
  });

  exportCtx.fillStyle = "#7f877f";
  exportCtx.font = '8px "Aptos", "Segoe UI", "Strata SC", sans-serif';
  exportCtx.fillText("剖面由当前高度网格逐点重算，未使用预渲染切片。", footerX + 18, footerY + 153);

  const profileX = footerX + footerWidth - 512;
  const profileY = footerY + 19;
  drawRoundedRect(exportCtx, profileX, profileY, 492, 142, 6, "#eeeade", "rgba(30,40,37,0.12)");
  exportCtx.save();
  drawRoundedRect(exportCtx, profileX, profileY, 492, 142, 6, null);
  exportCtx.clip();
  exportCtx.drawImage(profileCanvas, profileX, profileY, 492, 142);
  exportCtx.restore();
  exportCtx.fillStyle = "#8d5e49";
  exportCtx.font = '7px "SFMono-Regular", monospace';
  exportCtx.fillText("LIVE A—A′ SECTION", profileX + 10, profileY + 14);

  exportCtx.textAlign = "right";
  exportCtx.fillStyle = "#8b9289";
  exportCtx.font = '7px "SFMono-Regular", monospace';
  exportCtx.fillText("CANVAS 2D · CONTOURS / RELIEF / STRATA", exportWidth - gutter - 18, footerY + 187);
  exportCtx.textAlign = "left";

  output.toBlob((blob) => {
    dom.exportButton.disabled = false;
    if (!blob) {
      showToast("导出失败，请重试");
      return;
    }
    const link = document.createElement("a");
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    link.href = URL.createObjectURL(blob);
    link.download = `strata-${state.presetId}-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    showToast("PNG 已导出 · 含当前剖面");
  }, "image/png");
}

function setTool(tool) {
  state.tool = tool;
  dom.toolButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  dom.editState.textContent = `${TOOL_NAMES[tool]}模式`;
}

function applyEdit(hit) {
  if (!hit) return false;
  const strength = state.tool === "smooth" ? 0.01 : 0.024;
  const changed = applyBrush(
    state.terrain,
    hit.x,
    hit.y,
    brushRadiusNormal(),
    state.tool,
    strength,
  );
  if (changed) {
    requestRender();
    requestProfile();
  }
  return changed;
}

function startEdit(event) {
  if (event.button !== 0 && event.pointerType !== "touch") return;
  const hit = nearestTerrainPoint(event.clientX, event.clientY);
  if (!hit) {
    showToast("请对准可见地表拖动");
    return;
  }
  event.preventDefault();
  stageCanvas.setPointerCapture?.(event.pointerId);
  pushHistory(state.history, state.terrain);
  state.editing = true;
  state.lastEditTime = performance.now();
  state.lastEditPoint = { x: hit.x, y: hit.y };
  applyEdit(hit);
  updateCursor(hit);
  dom.editState.textContent = `${TOOL_NAMES[state.tool]}中 · 剖面随动`;
}

function continueEdit(event) {
  const hit = nearestTerrainPoint(event.clientX, event.clientY);
  updateCursor(hit);
  if (!state.editing || !hit) return;
  event.preventDefault();
  const now = performance.now();
  const moved = state.lastEditPoint
    ? Math.hypot(hit.x - state.lastEditPoint.x, hit.y - state.lastEditPoint.y)
    : Infinity;
  if (now - state.lastEditTime < 36 && moved < 0.018) return;
  state.lastEditTime = now;
  state.lastEditPoint = { x: hit.x, y: hit.y };
  applyEdit(hit);
}

function finishEdit() {
  if (!state.editing) return;
  state.editing = false;
  state.lastEditPoint = null;
  dom.editState.textContent = "剖面同步中";
  scheduleSyncCheck();
  window.setTimeout(() => {
    if (!state.editing && dom.editState.textContent === "剖面同步中") {
      dom.editState.textContent = "剖面已同步";
    }
  }, 280);
}

function bindEvents() {
  dom.toolButtons.forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  dom.brushSize.addEventListener("input", () => {
    state.brushSize = Number(dom.brushSize.value);
    dom.brushSizeLabel.textContent = String(state.brushSize);
    setRangeProgress(dom.brushSize, state.brushSize);
    if (state.hover) updateCursor(state.hover);
  });

  dom.cutPosition.addEventListener("input", () => {
    const cut = Number(dom.cutPosition.value) / 100;
    state.terrain.cutPosition = cut;
    dom.cutValue.textContent = `${dom.cutPosition.value}%`;
    dom.cutReadout.textContent = `A—A′ · ${cut.toFixed(2)}`;
    setRangeProgress(dom.cutPosition, Number(dom.cutPosition.value));
    state.hover = null;
    updateCursor(null);
    requestRender();
    requestProfile();
    scheduleSyncCheck();
  });

  dom.waterLevel.addEventListener("input", () => {
    state.terrain.waterLevel = Number(dom.waterLevel.value) / MAX_ELEVATION_M;
    dom.waterValue.textContent = `${dom.waterLevel.value} m`;
    setRangeProgress(dom.waterLevel, Number(dom.waterLevel.value));
    requestRender();
    requestProfile();
  });

  stageCanvas.addEventListener("pointerdown", startEdit);
  stageCanvas.addEventListener("pointermove", continueEdit);
  stageCanvas.addEventListener("pointerleave", () => {
    if (!state.editing) updateCursor(null);
  });
  window.addEventListener("pointerup", finishEdit);
  window.addEventListener("pointercancel", finishEdit);

  stageShell.addEventListener("wheel", (event) => {
    event.preventDefault();
    const next = clamp(state.brushSize + (event.deltaY > 0 ? -3 : 3), 12, 76);
    state.brushSize = next;
    dom.brushSize.value = String(next);
    dom.brushSizeLabel.textContent = String(next);
    setRangeProgress(dom.brushSize, next);
    if (state.hover) updateCursor(state.hover);
  }, { passive: false });

  dom.syncChip.addEventListener("click", () => runSyncCheck(true));
  dom.undoButton.addEventListener("click", undoEdit);
  dom.resetButton.addEventListener("click", resetCurrentTerrain);
  dom.exportButton.addEventListener("click", exportPng);

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement) return;
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoEdit();
      }
      return;
    }
    const shortcuts = { "1": "raise", "2": "lower", "3": "carve", "4": "smooth" };
    if (shortcuts[event.key]) {
      event.preventDefault();
      setTool(shortcuts[event.key]);
    } else if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportPng();
    }
  });

  const observer = new ResizeObserver(() => {
    requestRender();
    requestProfile();
  });
  observer.observe(stageShell);
  observer.observe(profileCanvas);
}

function init() {
  dom.brushSizeLabel.textContent = String(state.brushSize);
  setRangeProgress(dom.brushSize, state.brushSize);
  updateControlsFromTerrain();
  bindEvents();
  requestRender();
  requestProfile();
  document.fonts?.ready.then(() => {
    requestRender();
    requestProfile();
  });
  requestAnimationFrame(() => runSyncCheck(false));
}

window.__strataLab = {
  verifySections: () => runSyncCheck(false),
  verifyPresetPair: (first = "canyon", second = "mesa") => {
    const terrainA = createTerrain(first);
    const terrainB = createTerrain(second);
    const checkA = validateSection(terrainA);
    const checkB = validateSection(terrainB);
    return {
      passed: checkA.valid && checkB.valid,
      presets: [first, second],
      checks: [checkA, checkB],
    };
  },
  buildSection: () => buildSection(state.terrain, state.terrain.cutPosition),
  getState: () => ({
    presetId: state.presetId,
    cutPosition: state.terrain.cutPosition,
    waterLevel: state.terrain.waterLevel,
    layers: state.terrain.layers.map((layer) => ({ ...layer })),
    heights: Array.from(state.terrain.heights),
    lastSyncCheck: state.lastSyncCheck,
  }),
  exportPng,
};

init();
