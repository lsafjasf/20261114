"use strict";

const GRID = { cols: 12, rows: 8, cellMeters: 400 };
const TOTAL_GROSS_GWH = 4 * 14 * 3860 / 1000;
const ROTOR_RADIUS = 0.16;
const DOMINANT_BEARING = 300;
const STORAGE_KEY = "tideflow-layout-v1";

const WIND_SECTORS = [
  { bearing: 300, weight: 0.24, speed: 10.2 },
  { bearing: 315, weight: 0.16, speed: 9.8 },
  { bearing: 270, weight: 0.13, speed: 8.8 },
  { bearing: 240, weight: 0.12, speed: 8.6 },
  { bearing: 210, weight: 0.09, speed: 8.2 },
  { bearing: 330, weight: 0.08, speed: 9.4 },
  { bearing: 180, weight: 0.07, speed: 7.6 },
  { bearing: 150, weight: 0.06, speed: 7.2 },
  { bearing: 120, weight: 0.05, speed: 7.0 }
];

const SHIP_ROUTE = [
  { x: -1, y: 6.7 }, { x: 2.8, y: 6.45 }, { x: 6.2, y: 6.0 },
  { x: 9.5, y: 5.5 }, { x: 13, y: 5.75 }
];
const BIRD_ROUTE = [
  { x: -1, y: 1.1 }, { x: 2.0, y: 1.65 }, { x: 4.7, y: 1.3 },
  { x: 7.3, y: 2.1 }, { x: 9.6, y: 3.5 }, { x: 13, y: 4.15 }
];
const SHIP_HALF_WIDTH = 0.52;
const BIRD_HALF_WIDTH = 0.56;

const START_LAYOUTS = {
  A: [
    { x: 1.5, y: 3.5, angle: 300 },
    { x: 2.5, y: 3.5, angle: 300 },
    { x: 3.5, y: 3.5, angle: 300 },
    { x: 4.5, y: 3.5, angle: 300 }
  ],
  B: [
    { x: 1.5, y: 2.5, angle: 300 },
    { x: 3.5, y: 3.5, angle: 300 },
    { x: 5.5, y: 4.5, angle: 300 },
    { x: 8.5, y: 4.5, angle: 300 }
  ]
};

const MONTH_FACTORS = [1.13, 1.1, 1.05, 0.95, 0.83, 0.72, 0.67, 0.74, 0.87, 1.0, 1.09, 1.18];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = (degrees) => degrees * Math.PI / 180;
const deg = (radians) => radians * 180 / Math.PI;

function cloneLayout(layout) {
  return layout.map((turbine, index) => ({
    id: `WT-0${index + 1}`,
    x: turbine.x,
    y: turbine.y,
    angle: turbine.angle,
    confirmed: Boolean(turbine.confirmed)
  }));
}

function makeInitialSchemes() {
  return {
    A: cloneLayout(START_LAYOUTS.A),
    B: cloneLayout(START_LAYOUTS.B)
  };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToRoute(x, y, route) {
  let nearest = Infinity;
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index];
    const b = route[index + 1];
    nearest = Math.min(nearest, distanceToSegment(x, y, a.x, a.y, b.x, b.y));
  }
  return nearest;
}

function clearanceAt(x, y) {
  const ship = distanceToRoute(x, y, SHIP_ROUTE) - SHIP_HALF_WIDTH;
  const bird = distanceToRoute(x, y, BIRD_ROUTE) - BIRD_HALF_WIDTH;
  return { ship, bird, minimum: Math.min(ship, bird) };
}

function blockingZone(x, y) {
  const clearance = clearanceAt(x, y);
  if (clearance.ship <= 0) return "主航道缓冲";
  if (clearance.bird <= 0) return "鸟群迁徙带";
  return "";
}

function sectorVector(bearing) {
  const toBearing = rad((bearing + 180) % 360);
  return { x: Math.sin(toBearing), y: -Math.cos(toBearing) };
}

function shortestAngle(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function evaluateLayout(layout) {
  let weightedEfficiency = 0;
  let weightedWake = 0;
  let weightedYawLoss = 0;
  const sectorEfficiencies = [];

  WIND_SECTORS.forEach((sector) => {
    const wind = sectorVector(sector.bearing);
    const losses = layout.map((target, targetIndex) => {
      let deficit = 0;
      layout.forEach((source, sourceIndex) => {
        if (sourceIndex === targetIndex) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const downwind = dx * wind.x + dy * wind.y;
        if (downwind <= 0.08) return;
        const lateral = Math.abs(dx * wind.y - dy * wind.x);
        const wakeRadius = ROTOR_RADIUS + 0.075 * downwind;
        const influenceRadius = wakeRadius * 1.3;
        if (lateral >= influenceRadius) return;
        const overlap = 1 - lateral / influenceRadius;
        deficit += 0.68 * Math.pow(ROTOR_RADIUS / wakeRadius, 2) * overlap;
      });
      const yawError = Math.abs(shortestAngle(target.angle, DOMINANT_BEARING));
      const yawFactor = Math.pow(Math.max(0, Math.cos(rad(yawError))), 2.2);
      return { deficit: clamp(deficit, 0, 0.62), yawFactor };
    });
    const efficiency = losses.reduce((sum, item) => sum + (1 - item.deficit) * item.yawFactor, 0) / layout.length;
    const meanWake = losses.reduce((sum, item) => sum + item.deficit, 0) / layout.length;
    const meanYawLoss = losses.reduce((sum, item) => sum + (1 - item.yawFactor), 0) / layout.length;
    weightedEfficiency += efficiency * sector.weight;
    weightedWake += meanWake * sector.weight;
    weightedYawLoss += meanYawLoss * sector.weight;
    sectorEfficiencies.push(efficiency);
  });

  const mean = sectorEfficiencies.reduce((sum, value) => sum + value, 0) / sectorEfficiencies.length;
  const variance = sectorEfficiencies.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / sectorEfficiencies.length;
  const volatility = Math.sqrt(variance);
  const wakeLoss = weightedWake * 100;
  const yawLoss = weightedYawLoss * 100;
  const stability = clamp(100 - volatility * 215 - wakeLoss * 0.7 - Math.max(0, yawLoss - 2) * 0.5, 0, 99.4);
  const annual = TOTAL_GROSS_GWH * weightedEfficiency;
  const score = annual * (0.84 + stability * 0.0016);

  const violations = layout
    .map((turbine, index) => ({ index, zone: blockingZone(turbine.x, turbine.y) }))
    .filter((item) => item.zone);
  const minimumClearance = layout.reduce((minimum, turbine) => {
    const clearance = clearanceAt(turbine.x, turbine.y).minimum;
    return Math.min(minimum, clearance);
  }, Infinity);

  return {
    annual,
    stability,
    wakeLoss,
    yawLoss,
    score,
    violations,
    minimumClearance,
    sectorEfficiencies
  };
}

function formatSigned(value, digits = 1) {
  const rounded = Number(value.toFixed(digits));
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(digits)}`;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.schemes));
  } catch (error) {
    console.warn("Layout state could not be saved", error);
  }
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || !Array.isArray(stored.A) || !Array.isArray(stored.B) || stored.A.length !== 4 || stored.B.length !== 4) {
      return makeInitialSchemes();
    }
    return {
      A: cloneLayout(stored.A),
      B: cloneLayout(stored.B)
    };
  } catch (error) {
    return makeInitialSchemes();
  }
}

const state = {
  schemes: loadState(),
  activeScheme: "A",
  selectedIndex: 0,
  drag: null,
  hovered: null,
  draggingRotation: false,
  soundOn: false,
  map: null,
  dpr: 1,
  lastTime: performance.now(),
  toastTimer: null
};

const mapCanvas = document.getElementById("mapCanvas");
const mapCtx = mapCanvas.getContext("2d");
const windRoseCanvas = document.getElementById("windRoseCanvas");
const windRoseCtx = windRoseCanvas.getContext("2d");

const RIPPLE_SEEDS = Array.from({ length: 54 }, (_, index) => ({
  x: ((index * 73) % 997) / 997,
  y: ((index * 47 + 19) % 991) / 991,
  size: 0.025 + ((index * 29) % 31) / 780,
  speed: 0.4 + ((index * 17) % 19) / 22,
  phase: (index * 1.8) % Math.PI
}));

function computeMapRect(width, height, compact = false) {
  const narrow = !compact && width < 640;
  const padX = compact ? width * 0.045 : narrow ? 13 : Math.max(34, width * 0.04);
  const padTop = compact ? height * 0.13 : narrow ? 84 : 112;
  const padBottom = compact ? height * 0.15 : narrow ? 80 : 116;
  const cell = Math.min(
    (width - padX * 2) / GRID.cols,
    (height - padTop - padBottom) / GRID.rows
  );
  const mapWidth = cell * GRID.cols;
  const mapHeight = cell * GRID.rows;
  return {
    left: (width - mapWidth) / 2,
    top: padTop + Math.max(0, (height - padTop - padBottom - mapHeight) * 0.42),
    width: mapWidth,
    height: mapHeight,
    cell,
    compact
  };
}

function worldToScreen(x, y, map) {
  return { x: map.left + x * map.cell, y: map.top + y * map.cell };
}

function screenToWorld(x, y, map) {
  return { x: (x - map.left) / map.cell, y: (y - map.top) / map.cell };
}

function resizeMapCanvas() {
  const bounds = mapCanvas.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  if (mapCanvas.width !== width * state.dpr || mapCanvas.height !== height * state.dpr) {
    mapCanvas.width = width * state.dpr;
    mapCanvas.height = height * state.dpr;
  }
  state.map = {
    width,
    height,
    rect: computeMapRect(width, height, false)
  };
  mapCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawOcean(ctx, width, height, map, time) {
  const backdrop = ctx.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, "#071b22");
  backdrop.addColorStop(0.48, "#08252d");
  backdrop.addColorStop(1, "#061a22");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.2, height * 0.2, 0, width * 0.2, height * 0.2, width * 0.8);
  glow.addColorStop(0, "rgba(66, 146, 138, 0.14)");
  glow.addColorStop(1, "rgba(4, 20, 24, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  roundedRectPath(ctx, map.left, map.top, map.width, map.height, map.compact ? 3 : 9);
  ctx.clip();

  const sea = ctx.createLinearGradient(map.left, map.top, map.left + map.width, map.top + map.height);
  sea.addColorStop(0, "#0a3540");
  sea.addColorStop(0.58, "#0a303c");
  sea.addColorStop(1, "#071f2b");
  ctx.fillStyle = sea;
  ctx.fillRect(map.left, map.top, map.width, map.height);

  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = "#8ad3ca";
  ctx.lineWidth = map.compact ? 0.6 : 0.9;
  const contourStep = map.cell * 0.78;
  for (let index = 0; index < 8; index += 1) {
    ctx.beginPath();
    const baseY = map.top + map.height * (0.18 + index * 0.1);
    for (let x = map.left - 20; x <= map.left + map.width + 20; x += 14) {
      const nx = (x - map.left) / map.width;
      const y = baseY + Math.sin(nx * 7.2 + index * 0.9) * contourStep * 0.3 + Math.sin(nx * 3.1) * 12;
      if (x === map.left - 20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const rippleScale = map.compact ? 0.5 : 1;
  RIPPLE_SEEDS.forEach((ripple) => {
    const x = map.left + (ripple.x * 0.96 + 0.02) * map.width;
    const y = map.top + (ripple.y * 0.96 + 0.02) * map.height;
    const drift = Math.sin(time * 0.00015 * ripple.speed + ripple.phase) * 7;
    const radius = map.cell * ripple.size * 0.9;
    ctx.save();
    ctx.globalAlpha = 0.2 + 0.1 * Math.sin(time * 0.0007 + ripple.phase);
    ctx.strokeStyle = "#a4e3d7";
    ctx.lineWidth = 0.7 * rippleScale;
    ctx.beginPath();
    ctx.arc(x + drift, y, radius, 0.12 * Math.PI, 0.54 * Math.PI);
    ctx.arc(x + drift + radius * 0.8, y + radius * 0.04, radius * 0.48, 0.84 * Math.PI, 1.38 * Math.PI);
    ctx.stroke();
    ctx.restore();
  });

  ctx.restore();

  ctx.save();
  roundedRectPath(ctx, map.left, map.top, map.width, map.height, map.compact ? 3 : 9);
  ctx.strokeStyle = "rgba(185, 222, 211, 0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawGrid(ctx, map, time) {
  const { left, top, cell } = map;
  const compact = map.compact;
  ctx.save();
  roundedRectPath(ctx, left, top, map.width, map.height, compact ? 3 : 9);
  ctx.clip();

  ctx.font = `${compact ? 7 : 8}px "Ubuntu Mono", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let row = 0; row < GRID.rows; row += 1) {
    for (let col = 0; col < GRID.cols; col += 1) {
      const x = left + col * cell;
      const y = top + row * cell;
      ctx.fillStyle = (row + col) % 2 ? "rgba(143, 226, 201, 0.016)" : "rgba(0, 0, 0, 0.025)";
      ctx.fillRect(x, y, cell, cell);
    }
  }

  ctx.strokeStyle = "rgba(149, 205, 192, 0.15)";
  ctx.lineWidth = 0.75;
  for (let col = 0; col <= GRID.cols; col += 1) {
    ctx.beginPath();
    ctx.moveTo(left + col * cell, top);
    ctx.lineTo(left + col * cell, top + map.height);
    ctx.stroke();
  }
  for (let row = 0; row <= GRID.rows; row += 1) {
    ctx.beginPath();
    ctx.moveTo(left, top + row * cell);
    ctx.lineTo(left + map.width, top + row * cell);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(149, 205, 192, 0.34)";
  ctx.lineWidth = 1;
  for (let col = 0; col <= GRID.cols; col += 4) {
    ctx.beginPath();
    ctx.moveTo(left + col * cell, top);
    ctx.lineTo(left + col * cell, top + map.height);
    ctx.stroke();
  }
  for (let row = 0; row <= GRID.rows; row += 2) {
    ctx.beginPath();
    ctx.moveTo(left, top + row * cell);
    ctx.lineTo(left + map.width, top + row * cell);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(204, 232, 223, 0.42)";
  for (let col = 0; col < GRID.cols; col += 1) {
    ctx.fillText(String(col + 1).padStart(2, "0"), left + (col + 0.5) * cell, top - 9);
  }
  ctx.textAlign = "left";
  for (let row = 0; row < GRID.rows; row += 1) {
    ctx.fillText(String.fromCharCode(65 + row), left - 17, top + (row + 0.5) * cell);
  }
  ctx.restore();
}

function makeBandPolygon(route, halfWidth) {
  const left = [];
  const right = [];
  route.forEach((point, index) => {
    const previous = route[Math.max(0, index - 1)];
    const next = route[Math.min(route.length - 1, index + 1)];
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty) || 1;
    const nx = -ty / length;
    const ny = tx / length;
    left.push({ x: point.x + nx * halfWidth, y: point.y + ny * halfWidth });
    right.push({ x: point.x - nx * halfWidth, y: point.y - ny * halfWidth });
  });
  return left.concat(right.reverse());
}

function tracePolygon(ctx, points, map) {
  ctx.beginPath();
  points.forEach((point, index) => {
    const screen = worldToScreen(point.x, point.y, map);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.closePath();
}

function drawHatching(ctx, map, points, color, spacing) {
  const minX = Math.min(...points.map((point) => worldToScreen(point.x, point.y, map).x));
  const maxX = Math.max(...points.map((point) => worldToScreen(point.x, point.y, map).x));
  const minY = Math.min(...points.map((point) => worldToScreen(point.x, point.y, map).y));
  const maxY = Math.max(...points.map((point) => worldToScreen(point.x, point.y, map).y));
  ctx.save();
  tracePolygon(ctx, points, map);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = map.compact ? 0.55 : 0.75;
  const step = spacing || map.cell * 0.22;
  for (let offset = minX - (maxY - minY); offset < maxX; offset += step) {
    ctx.beginPath();
    ctx.moveTo(offset, maxY);
    ctx.lineTo(offset + (maxY - minY), minY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabelPill(ctx, text, x, y, options = {}) {
  const fontSize = options.fontSize || 8;
  const padX = options.padX || 7;
  const height = options.height || 19;
  ctx.save();
  ctx.font = `${options.bold ? "600 " : ""}${fontSize}px "Ubuntu Sans", sans-serif`;
  const width = ctx.measureText(text).width + padX * 2;
  const left = options.align === "right" ? x - width : x;
  roundedRectPath(ctx, left, y - height / 2, width, height, 4);
  ctx.fillStyle = options.background || "rgba(4, 20, 24, 0.85)";
  ctx.fill();
  if (options.border) {
    ctx.strokeStyle = options.border;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  ctx.fillStyle = options.color || "#dfeee6";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, y + 0.5);
  ctx.restore();
  return width;
}

function drawForbiddenZones(ctx, map, time) {
  const compact = map.compact;
  const shipBand = makeBandPolygon(SHIP_ROUTE, SHIP_HALF_WIDTH);
  const birdBand = makeBandPolygon(BIRD_ROUTE, BIRD_HALF_WIDTH);

  ctx.save();
  tracePolygon(ctx, shipBand, map);
  ctx.fillStyle = "rgba(54, 115, 145, 0.2)";
  ctx.fill();
  ctx.strokeStyle = "rgba(98, 183, 217, 0.64)";
  ctx.lineWidth = compact ? 0.8 : 1;
  ctx.setLineDash(compact ? [3, 4] : [5, 5]);
  ctx.stroke();
  drawHatching(ctx, map, shipBand, "rgba(98, 183, 217, 0.13)");

  tracePolygon(ctx, birdBand, map);
  ctx.fillStyle = "rgba(132, 67, 60, 0.17)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 130, 111, 0.54)";
  ctx.lineWidth = compact ? 0.8 : 1;
  ctx.setLineDash(compact ? [3, 4] : [5, 5]);
  ctx.stroke();
  drawHatching(ctx, map, birdBand, "rgba(255, 130, 111, 0.11)", map.cell * 0.26);
  ctx.restore();

  drawRouteArrows(ctx, map, SHIP_ROUTE, "rgba(130, 211, 233, 0.56)");
  drawBirdMarks(ctx, map, BIRD_ROUTE, time);

  const shipPoint = worldToScreen(6.7, 6.15, map);
  drawLabelPill(ctx, "主航道 · 禁止布点", shipPoint.x, shipPoint.y - (compact ? 2 : 8), {
    fontSize: compact ? 6.5 : 8,
    height: compact ? 14 : 20,
    color: "#aaddec",
    background: "rgba(10, 35, 43, 0.9)",
    border: "rgba(98, 183, 217, 0.38)"
  });

  const birdPoint = worldToScreen(6.4, 1.55, map);
  drawLabelPill(ctx, "鸟群迁徙带 · 禁布", birdPoint.x, birdPoint.y - (compact ? 4 : 11), {
    fontSize: compact ? 6.5 : 8,
    height: compact ? 14 : 20,
    color: "#ffc1b6",
    background: "rgba(43, 24, 23, 0.9)",
    border: "rgba(255, 130, 111, 0.35)"
  });

  if (!compact) {
    const seabed = worldToScreen(0.4, 5.4, map);
    drawLabelPill(ctx, "−24 m", seabed.x, seabed.y, {
      fontSize: 7,
      height: 15,
      color: "rgba(199, 231, 224, 0.45)",
      background: "rgba(6, 28, 33, 0.42)"
    });
  }
}

function drawRouteArrows(ctx, map, route, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = map.compact ? 0.8 : 1.1;
  for (let index = 0; index < route.length - 1; index += 1) {
    const a = worldToScreen(route[index].x, route[index].y, map);
    const b = worldToScreen(route[index + 1].x, route[index + 1].y, map);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const count = Math.max(2, Math.floor(length / 55));
    for (let segment = 1; segment <= count; segment += 1) {
      const t = segment / (count + 1);
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      const size = map.compact ? 3 : 4.5;
      ctx.beginPath();
      ctx.moveTo(x + (ux - uy * 0.7) * size, y + (uy + ux * 0.7) * size);
      ctx.lineTo(x, y);
      ctx.lineTo(x + (ux + uy * 0.7) * size, y + (uy - ux * 0.7) * size);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBirdMarks(ctx, map, route, time) {
  const totalSegments = route.length - 1;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 178, 163, 0.76)";
  ctx.lineWidth = map.compact ? 0.9 : 1.3;
  for (let index = 0; index < totalSegments; index += 1) {
    const a = route[index];
    const b = route[index + 1];
    for (let mark = 1; mark <= 2; mark += 1) {
      const t = mark / 3 + 0.035 * Math.sin(time * 0.001 + index + mark);
      const x = lerp(a.x, b.x, t);
      const y = lerp(a.y, b.y, t);
      const screen = worldToScreen(x, y, map);
      const size = map.compact ? 2.7 : 4.6;
      ctx.beginPath();
      ctx.moveTo(screen.x - size, screen.y);
      ctx.quadraticCurveTo(screen.x - size * 0.4, screen.y - size * 0.8, screen.x, screen.y);
      ctx.quadraticCurveTo(screen.x + size * 0.4, screen.y - size * 0.8, screen.x + size, screen.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawWakes(ctx, map, layout, metrics, time) {
  const wind = sectorVector(DOMINANT_BEARING);
  const angle = Math.atan2(wind.y, wind.x);
  const wakeLength = map.cell * 3.5;
  const startRadius = Math.max(4, map.cell * 0.19);
  const endSpread = map.cell * 0.55;
  const wakeStrength = clamp(0.7 + (metrics ? metrics.wakeLoss / 20 : 0.2), 0.72, 1.35);

  layout.forEach((turbine, index) => {
    const screen = worldToScreen(turbine.x, turbine.y, map);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(angle);

    const gradient = ctx.createLinearGradient(0, 0, wakeLength, 0);
    gradient.addColorStop(0, `rgba(109, 214, 207, ${0.25 * wakeStrength})`);
    gradient.addColorStop(0.38, `rgba(91, 185, 188, ${0.13 * wakeStrength})`);
    gradient.addColorStop(0.78, "rgba(93, 167, 184, 0.045)");
    gradient.addColorStop(1, "rgba(93, 167, 184, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(startRadius, -startRadius);
    ctx.quadraticCurveTo(wakeLength * 0.48, -startRadius - endSpread * 0.5, wakeLength, -startRadius - endSpread);
    ctx.lineTo(wakeLength, startRadius + endSpread);
    ctx.quadraticCurveTo(wakeLength * 0.48, startRadius + endSpread * 0.5, startRadius, startRadius);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(158, 231, 222, ${0.34 * wakeStrength})`;
    ctx.lineWidth = map.compact ? 0.45 : 0.65;
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = -time * 0.035;
    ctx.beginPath();
    ctx.moveTo(startRadius * 1.5, 0);
    ctx.lineTo(wakeLength, 0);
    ctx.stroke();

    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = "rgba(151, 226, 216, 0.12)";
    ctx.beginPath();
    ctx.moveTo(startRadius * 1.5, -startRadius * 0.45);
    ctx.quadraticCurveTo(wakeLength * 0.45, -endSpread * 0.45, wakeLength * 0.92, -endSpread * 0.78);
    ctx.moveTo(startRadius * 1.5, startRadius * 0.45);
    ctx.quadraticCurveTo(wakeLength * 0.45, endSpread * 0.45, wakeLength * 0.92, endSpread * 0.78);
    ctx.stroke();

    if (!map.compact) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(191, 235, 226, 0.32)";
      ctx.font = '7px "Ubuntu Mono", monospace';
      ctx.textAlign = "left";
      ctx.fillText("WAKE", startRadius + 13, -startRadius - 13 - ((index % 2) * 2));
    }
    ctx.restore();
  });
}

function drawTurbine(ctx, map, turbine, index, options = {}) {
  const screen = worldToScreen(turbine.x, turbine.y, map);
  const pad = clamp(map.cell * (map.compact ? 0.22 : 0.27), map.compact ? 5 : 11, map.compact ? 13 : 23);
  const selected = options.selected && !map.compact;
  const blocked = options.blocked;
  const time = options.time || 0;
  const ringColor = blocked ? "#ff826f" : selected ? "#d8f57b" : "#8fe2c9";

  ctx.save();
  ctx.translate(screen.x, screen.y);

  if (selected) {
    const pulse = 1 + Math.sin(time * 0.0024) * 0.035;
    ctx.strokeStyle = "rgba(216, 245, 123, 0.24)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, pad + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(216, 245, 123, 0.9)";
    ctx.lineWidth = 1.3;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -time * 0.012;
    ctx.beginPath();
    ctx.arc(0, 0, (pad + 6) * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.shadowColor = blocked ? "rgba(255, 98, 80, 0.55)" : selected ? "rgba(216,245,123,.36)" : "rgba(0,0,0,.45)";
  ctx.shadowBlur = selected ? 18 : 10;
  const padGradient = ctx.createRadialGradient(-pad * 0.25, -pad * 0.3, 0, 0, 0, pad + 2);
  padGradient.addColorStop(0, blocked ? "#ffd0c5" : "#e8f4e6");
  padGradient.addColorStop(0.28, blocked ? "#f07563" : selected ? "#d8f57b" : "#9fd8c3");
  padGradient.addColorStop(1, blocked ? "#6e2b25" : selected ? "#44613d" : "#16453f");
  ctx.fillStyle = padGradient;
  ctx.beginPath();
  ctx.arc(0, 0, pad, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = selected ? 1.6 : 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(5, 25, 28, 0.84)";
  ctx.beginPath();
  ctx.arc(0, 0, pad * 0.53, 0, Math.PI * 2);
  ctx.fill();

  const rotor = pad * 0.68;
  ctx.save();
  ctx.rotate(time * 0.00075 + index * 0.8);
  for (let blade = 0; blade < 3; blade += 1) {
    ctx.save();
    ctx.rotate(blade * Math.PI * 2 / 3);
    ctx.fillStyle = blocked ? "rgba(255, 207, 199, 0.9)" : selected ? "rgba(232, 249, 164, 0.95)" : "rgba(206, 239, 225, 0.9)";
    ctx.beginPath();
    ctx.moveTo(0, -1.2);
    ctx.quadraticCurveTo(rotor * 0.57, -rotor * 0.14, rotor, 0);
    ctx.quadraticCurveTo(rotor * 0.58, rotor * 0.12, 0, 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  ctx.fillStyle = ringColor;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.7, pad * 0.12), 0, Math.PI * 2);
  ctx.fill();

  const yawAngle = rad(turbine.angle - 90);
  const pointerLength = pad + 7;
  ctx.strokeStyle = selected ? "rgba(216,245,123,.75)" : "rgba(143,226,201,.24)";
  ctx.lineWidth = selected ? 1.6 : 0.8;
  ctx.beginPath();
  ctx.moveTo(Math.cos(yawAngle) * pad * 0.6, Math.sin(yawAngle) * pad * 0.6);
  ctx.lineTo(Math.cos(yawAngle) * pointerLength, Math.sin(yawAngle) * pointerLength);
  ctx.stroke();

  if (selected) {
    const handleX = Math.cos(yawAngle) * (pad + 18);
    const handleY = Math.sin(yawAngle) * (pad + 18);
    ctx.fillStyle = "#d8f57b";
    ctx.beginPath();
    ctx.arc(handleX, handleY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(7, 26, 31, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();

  if (!map.compact && map.cell > 31) {
    const labelY = screen.y - pad - 19;
    drawLabelPill(ctx, `WT-0${index + 1}`, screen.x, labelY, {
      fontSize: 8,
      height: 17,
      padX: 6,
      color: blocked ? "#ffd0c8" : selected ? "#edfbb8" : "#dff3e8",
      background: blocked ? "rgba(70, 29, 25, 0.9)" : "rgba(5, 24, 28, 0.86)",
      border: blocked ? "rgba(255,130,111,.55)" : selected ? "rgba(216,245,123,.5)" : "rgba(143,226,201,.22)"
    });
    if (turbine.confirmed) {
      ctx.fillStyle = "#8fe2c9";
      ctx.beginPath();
      ctx.arc(screen.x + pad + 4, screen.y - pad + 2, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(7,26,31,.9)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(screen.x + pad + 2.2, screen.y - pad + 2);
      ctx.lineTo(screen.x + pad + 3.8, screen.y - pad + 3.8);
      ctx.lineTo(screen.x + pad + 6.2, screen.y - pad - 0.2);
      ctx.stroke();
    }
  }
}

function drawBlockedGhost(ctx, map, candidate) {
  const screen = worldToScreen(candidate.x, candidate.y, map);
  const radius = clamp(map.cell * 0.27, 11, 23);
  ctx.save();
  ctx.fillStyle = "rgba(255, 92, 74, 0.14)";
  ctx.strokeStyle = "rgba(255, 130, 111, 0.9)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 207, 198, 0.9)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(screen.x - 5, screen.y - 5);
  ctx.lineTo(screen.x + 5, screen.y + 5);
  ctx.moveTo(screen.x + 5, screen.y - 5);
  ctx.lineTo(screen.x - 5, screen.y + 5);
  ctx.stroke();
  drawLabelPill(ctx, "禁止布点", screen.x, screen.y - radius - 21, {
    fontSize: 8,
    color: "#ffd0c8",
    background: "rgba(73, 27, 23, 0.94)",
    border: "rgba(255,130,111,.55)"
  });
  ctx.restore();
}

function activeLayout() {
  return state.schemes[state.activeScheme];
}

function previewLayout() {
  const layout = activeLayout().map((turbine) => ({ ...turbine }));
  if (state.drag && !state.drag.blocked) {
    layout[state.selectedIndex].x = state.drag.candidate.x;
    layout[state.selectedIndex].y = state.drag.candidate.y;
  }
  return layout;
}

function drawMapScene(ctx, width, height, layout, options = {}) {
  const map = options.map || computeMapRect(width, height, Boolean(options.compact));
  const time = options.time || 0;
  const metrics = options.metrics || evaluateLayout(layout);
  drawOcean(ctx, width, height, map, time);
  drawGrid(ctx, map, time);
  drawForbiddenZones(ctx, map, time);
  drawWakes(ctx, map, layout, metrics, time);
  layout.forEach((turbine, index) => {
    drawTurbine(ctx, map, turbine, index, {
      selected: !options.compact && index === state.selectedIndex,
      time,
      blocked: Boolean(blockingZone(turbine.x, turbine.y))
    });
  });
  return { map, metrics };
}

function renderMain(time) {
  if (!state.map) resizeMapCanvas();
  const { width, height, rect } = state.map;
  mapCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  mapCtx.clearRect(0, 0, width, height);
  const layout = previewLayout();
  const metrics = evaluateLayout(layout);
  drawMapScene(mapCtx, width, height, layout, { map: rect, time, metrics });

  if (state.drag && state.drag.blocked) {
    drawBlockedGhost(mapCtx, rect, state.drag.candidate);
  }

  const vignette = mapCtx.createLinearGradient(0, 0, 0, height);
  vignette.addColorStop(0, "rgba(5, 19, 24, 0.33)");
  vignette.addColorStop(0.22, "rgba(5, 19, 24, 0)");
  vignette.addColorStop(0.82, "rgba(5, 19, 24, 0)");
  vignette.addColorStop(1, "rgba(5, 19, 24, 0.46)");
  mapCtx.fillStyle = vignette;
  mapCtx.fillRect(0, 0, width, height);
}

function drawWindRose() {
  const width = 150;
  const height = 126;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  windRoseCanvas.width = width * dpr;
  windRoseCanvas.height = height * dpr;
  windRoseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  windRoseCtx.clearRect(0, 0, width, height);

  const cx = 75;
  const cy = 66;
  const inner = 18;
  const maxLength = 45;

  windRoseCtx.strokeStyle = "rgba(143, 226, 201, 0.16)";
  windRoseCtx.lineWidth = 0.7;
  [18, 31, 44].forEach((radius) => {
    windRoseCtx.beginPath();
    windRoseCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    windRoseCtx.stroke();
  });

  WIND_SECTORS.forEach((sector) => {
    const bearing = rad(sector.bearing - 90);
    const spread = rad(8);
    const length = inner + maxLength * (sector.weight / 0.24);
    const dominant = sector.bearing === DOMINANT_BEARING;
    windRoseCtx.fillStyle = dominant ? "rgba(216, 245, 123, 0.78)" : "rgba(143, 226, 201, 0.38)";
    windRoseCtx.beginPath();
    windRoseCtx.arc(cx, cy, inner, bearing - spread, bearing + spread);
    windRoseCtx.arc(cx, cy, length, bearing + spread, bearing - spread, true);
    windRoseCtx.closePath();
    windRoseCtx.fill();
  });

  windRoseCtx.fillStyle = "rgba(216, 245, 123, 0.92)";
  windRoseCtx.beginPath();
  windRoseCtx.arc(
    cx + Math.cos(rad(DOMINANT_BEARING - 90)) * (inner + maxLength * 0.95),
    cy + Math.sin(rad(DOMINANT_BEARING - 90)) * (inner + maxLength * 0.95),
    2.4,
    0,
    Math.PI * 2
  );
  windRoseCtx.fill();

  windRoseCtx.fillStyle = "#e8f4e8";
  windRoseCtx.font = '8px "Ubuntu Mono", monospace';
  windRoseCtx.textAlign = "center";
  windRoseCtx.fillText("N", cx, 7);
  windRoseCtx.fillText("E", 145, cy + 3);
  windRoseCtx.fillText("S", cx, 121);
  windRoseCtx.fillText("W", 5, cy + 3);
  windRoseCtx.fillStyle = "#6f8c89";
  windRoseCtx.font = '7px "Ubuntu Mono", monospace';
  windRoseCtx.fillText("NW", cx - 52, 18);
}

function initMonthBars() {
  const container = document.getElementById("monthBars");
  container.innerHTML = MONTHS.map((month) => `<i title="${month}" style="height:10%"></i>`).join("");
}

function updateMonthlyBars(metrics) {
  const container = document.getElementById("monthBars");
  const base = Math.min(...MONTH_FACTORS);
  const max = Math.max(...MONTH_FACTORS);
  const efficiencyLift = (metrics.annual / TOTAL_GROSS_GWH - 0.75) * 0.38;
  Array.from(container.children).forEach((bar, index) => {
    const normalized = (MONTH_FACTORS[index] - base) / (max - base);
    const height = 24 + normalized * 62 + efficiencyLift * 18;
    bar.style.height = `${clamp(height, 8, 100)}%`;
  });
}

function otherSchemeKey() {
  return state.activeScheme === "A" ? "B" : "A";
}

function updateDashboard() {
  const current = evaluateLayout(activeLayout());
  const other = evaluateLayout(state.schemes[otherSchemeKey()]);
  const selected = activeLayout()[state.selectedIndex];
  const offset = current.annual - other.annual;
  const percent = other.annual ? offset / other.annual * 100 : 0;

  document.getElementById("annualValue").textContent = current.annual.toFixed(1);
  const deltaPill = document.getElementById("deltaPill");
  deltaPill.textContent = `较方案 ${otherSchemeKey()} ${formatSigned(offset)} GWh`;
  deltaPill.classList.toggle("negative", offset < 0);
  document.getElementById("stabilityValue").textContent = `${current.stability.toFixed(0)}%`;
  document.getElementById("wakeValue").textContent = `${current.wakeLoss.toFixed(1)}%`;
  document.getElementById("stabilityMeter").style.width = `${current.stability}%`;
  document.getElementById("wakeMeter").style.width = `${clamp(current.wakeLoss * 4.2, 0, 100)}%`;
  updateMonthlyBars(current);

  document.getElementById("selectedName").textContent = selected.id;
  document.getElementById("selectedCoord").textContent = `网格 ${selected.x.toFixed(1)} · ${selected.y.toFixed(1)}`;
  document.getElementById("yawValue").textContent = `${Math.round(selected.angle) % 360}°`;
  document.getElementById("yawSlider").value = String(Math.round(selected.angle) % 360 / 5 * 5);
  const stateEl = document.getElementById("selectedState");
  stateEl.textContent = selected.confirmed ? "已确认" : "待确认";
  stateEl.classList.toggle("done", selected.confirmed);
  document.getElementById("confirmBtn").textContent = selected.confirmed ? "机位已确认" : "确认机位";
  document.getElementById("confirmBtn").disabled = selected.confirmed;

  const units = Array.from(document.querySelectorAll(".unit-btn"));
  units.forEach((button, index) => {
    button.classList.toggle("active", index === state.selectedIndex);
    button.classList.toggle("confirmed", activeLayout()[index].confirmed);
  });

  const compliant = current.violations.length === 0;
  document.getElementById("complianceBadge").textContent = compliant ? "4 / 4 合规" : `${4 - current.violations.length} / 4 合规`;
  document.getElementById("complianceBadge").classList.toggle("warn", !compliant);
  const laneViolations = current.violations.filter((item) => item.zone === "主航道缓冲").length;
  const birdViolations = current.violations.filter((item) => item.zone === "鸟群迁徙带").length;
  const laneStatus = document.getElementById("laneStatus");
  const birdStatus = document.getElementById("birdStatus");
  laneStatus.textContent = laneViolations ? `${laneViolations} 台越界` : "已避开";
  birdStatus.textContent = birdViolations ? `${birdViolations} 台越界` : "已避开";
  laneStatus.classList.toggle("warn", Boolean(laneViolations));
  birdStatus.classList.toggle("warn", Boolean(birdViolations));

  document.getElementById("mapStatusDot").style.background = compliant ? "var(--mint)" : "var(--coral)";
  document.getElementById("mapStatusText").textContent = compliant
    ? `实时校验 · 4 台机组在线 · 尾流 ${current.wakeLoss.toFixed(1)}%`
    : `实时校验 · ${current.violations.length} 台机组进入禁布区`;

  document.getElementById("schemeABtn").classList.toggle("active", state.activeScheme === "A");
  document.getElementById("schemeBBtn").classList.toggle("active", state.activeScheme === "B");
  document.getElementById("schemeABtn").setAttribute("aria-selected", String(state.activeScheme === "A"));
  document.getElementById("schemeBBtn").setAttribute("aria-selected", String(state.activeScheme === "B"));

  soundEngine.update(current.annual / 4, current.stability);
  return { current, other, percent };
}

function showToast(message, warning = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("warn", warning);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function selectTurbine(index) {
  state.selectedIndex = clamp(index, 0, 3);
  updateDashboard();
}

function switchScheme(key) {
  if (state.activeScheme === key) return;
  state.activeScheme = key;
  state.drag = null;
  updateDashboard();
  showToast(`已切换到方案 ${key}`);
}

function buildUnitPicker() {
  const picker = document.getElementById("unitPicker");
  picker.innerHTML = activeLayout()
    .map((_, index) => `<button class="unit-btn" type="button" data-unit="${index}" aria-label="选择第 ${index + 1} 台风机">T${index + 1}</button>`)
    .join("");
  picker.addEventListener("click", (event) => {
    const button = event.target.closest(".unit-btn");
    if (!button) return;
    selectTurbine(Number(button.dataset.unit));
  });
}

function pointerPosition(event) {
  const bounds = mapCanvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function findTurbineAt(point, map) {
  const minimum = Math.max(18, map.cell * 0.34);
  let nearest = -1;
  let nearestDistance = Infinity;
  activeLayout().forEach((turbine, index) => {
    const screen = worldToScreen(turbine.x, turbine.y, map);
    const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
    if (distance < minimum && distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function isOnRotationHandle(point, map) {
  if (state.drag) return false;
  const selected = activeLayout()[state.selectedIndex];
  const screen = worldToScreen(selected.x, selected.y, map);
  const pad = clamp(map.cell * 0.27, 11, 23);
  const angle = rad(selected.angle - 90);
  const handle = {
    x: screen.x + Math.cos(angle) * (pad + 18),
    y: screen.y + Math.sin(angle) * (pad + 18)
  };
  return Math.hypot(point.x - handle.x, point.y - handle.y) < 11;
}

function handlePointerDown(event) {
  if (!state.map) return;
  const point = pointerPosition(event);
  const map = state.map.rect;

  if (isOnRotationHandle(point, map)) {
    state.draggingRotation = true;
    state.drag = {
      mode: "rotate",
      origin: { ...activeLayout()[state.selectedIndex] }
    };
    mapCanvas.setPointerCapture(event.pointerId);
    return;
  }

  const hit = findTurbineAt(point, map);
  if (hit >= 0) {
    state.selectedIndex = hit;
    const selected = activeLayout()[hit];
    state.drag = {
      mode: "move",
      origin: { x: selected.x, y: selected.y },
      candidate: { x: selected.x, y: selected.y },
      blocked: false
    };
    updateDashboard();
    mapCanvas.setPointerCapture(event.pointerId);
  }
}

function handlePointerMove(event) {
  if (!state.map) return;
  const point = pointerPosition(event);
  const map = state.map.rect;

  if (!state.drag) {
    state.hovered = findTurbineAt(point, map);
    mapCanvas.style.cursor = state.hovered >= 0 ? "grab" : "crosshair";
    return;
  }

  const selected = activeLayout()[state.selectedIndex];
  if (state.drag.mode === "rotate") {
    const screen = worldToScreen(selected.x, selected.y, map);
    const dx = point.x - screen.x;
    const dy = point.y - screen.y;
    if (Math.hypot(dx, dy) > 5) {
      const bearing = (deg(Math.atan2(dx, -dy)) + 360) % 360;
      selected.angle = Math.round(bearing / 5) * 5 % 360;
      selected.confirmed = false;
      updateDashboard();
    }
    return;
  }

  const world = screenToWorld(point.x, point.y, map);
  const candidate = {
    x: clamp(Math.floor(world.x) + 0.5, 0.5, GRID.cols - 0.5),
    y: clamp(Math.floor(world.y) + 0.5, 0.5, GRID.rows - 0.5)
  };
  const zone = blockingZone(candidate.x, candidate.y);
  state.drag.candidate = candidate;
  state.drag.blocked = Boolean(zone);

  if (!zone) {
    const changed = selected.x !== candidate.x || selected.y !== candidate.y;
    selected.x = candidate.x;
    selected.y = candidate.y;
    if (changed) selected.confirmed = false;
    updateDashboard();
  } else {
    document.getElementById("mapStatusText").textContent = `禁止布点 · ${zone}`;
    document.getElementById("mapStatusDot").style.background = "var(--coral)";
  }
}

function handlePointerUp(event) {
  if (!state.drag || !state.map) return;
  const selected = activeLayout()[state.selectedIndex];

  if (state.drag.mode === "move" && state.drag.blocked) {
    selected.x = state.drag.origin.x;
    selected.y = state.drag.origin.y;
    showToast("该网格位于禁布区，机位已回弹", true);
  } else if (state.drag.mode === "move") {
    const moved = selected.x !== state.drag.origin.x || selected.y !== state.drag.origin.y;
    if (moved) showToast(`${selected.id} 已移动至网格 ${selected.x.toFixed(1)} · ${selected.y.toFixed(1)}`);
  }

  state.drag = null;
  state.draggingRotation = false;
  if (mapCanvas.hasPointerCapture(event.pointerId)) mapCanvas.releasePointerCapture(event.pointerId);
  saveState();
  updateDashboard();
}

function alignSelected() {
  const selected = activeLayout()[state.selectedIndex];
  selected.angle = DOMINANT_BEARING;
  selected.confirmed = false;
  updateDashboard();
  saveState();
  showToast(`${selected.id} 已对齐主导来风 300°`);
}

function rotateBy(delta) {
  const selected = activeLayout()[state.selectedIndex];
  selected.angle = (Math.round((selected.angle + delta) / 5) * 5 + 360) % 360;
  selected.confirmed = false;
  updateDashboard();
  saveState();
}

function confirmSelected() {
  const selected = activeLayout()[state.selectedIndex];
  if (selected.confirmed) return;
  selected.confirmed = true;
  const next = activeLayout().findIndex((turbine) => !turbine.confirmed);
  if (next >= 0) state.selectedIndex = next;
  updateDashboard();
  saveState();
  const allDone = activeLayout().every((turbine) => turbine.confirmed);
  showToast(allDone ? "四台机位已全部确认 · 年度评估已刷新" : `${selected.id} 已确认，继续选择下一台`);
}

function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function bindInterface() {
  document.getElementById("schemeABtn").addEventListener("click", () => switchScheme("A"));
  document.getElementById("schemeBBtn").addEventListener("click", () => switchScheme("B"));
  document.getElementById("alignBtn").addEventListener("click", alignSelected);
  document.getElementById("confirmBtn").addEventListener("click", confirmSelected);
  document.getElementById("yawSlider").addEventListener("input", (event) => {
    const selected = activeLayout()[state.selectedIndex];
    selected.angle = Number(event.target.value);
    selected.confirmed = false;
    updateDashboard();
  });
  document.getElementById("yawSlider").addEventListener("change", saveState);

  document.getElementById("cloneBtn").addEventListener("click", () => {
    const target = otherSchemeKey();
    state.schemes[target] = cloneLayout(activeLayout()).map((turbine) => ({ ...turbine, confirmed: false }));
    saveState();
    updateDashboard();
    showToast(`当前机位已复制到方案 ${target}`);
  });

  mapCanvas.addEventListener("pointerdown", handlePointerDown);
  mapCanvas.addEventListener("pointermove", handlePointerMove);
  mapCanvas.addEventListener("pointerup", handlePointerUp);
  mapCanvas.addEventListener("pointercancel", handlePointerUp);
  mapCanvas.addEventListener("pointerleave", () => {
    if (!state.drag) {
      state.hovered = null;
      mapCanvas.style.cursor = "crosshair";
    }
  });
  mapCanvas.addEventListener("wheel", (event) => {
    const point = pointerPosition(event);
    const hit = findTurbineAt(point, state.map.rect);
    if (hit !== state.selectedIndex && hit >= 0) state.selectedIndex = hit;
    if (hit < 0 && state.hovered === null) return;
    event.preventDefault();
    rotateBy(event.deltaY > 0 ? 5 : -5);
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea, select")) return;
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      alignSelected();
    }
    if (event.key === "Escape") {
      closeModal("resultsModal");
      closeModal("helpModal");
    }
  });

  document.getElementById("helpBtn").addEventListener("click", () => openModal("helpModal"));
  document.querySelectorAll("[data-close-modal]").forEach((element) => {
    element.addEventListener("click", () => {
      const modal = element.closest(".modal");
      if (modal) closeModal(modal.id);
    });
  });

  window.addEventListener("resize", () => {
    resizeMapCanvas();
    drawWindRose();
  });
}

class SoundEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.oceanGain = null;
    this.humGain = null;
    this.hum = null;
    this.harmonic = null;
    this.filter = null;
    this.playing = false;
  }

  init() {
    if (this.context) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();

    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const duration = 2;
    const buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.018 * white) / 1.018;
      channel[index] = last * 3.4;
    }
    const noise = this.context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.filter = this.context.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 560;
    this.filter.Q.value = 0.45;
    this.oceanGain = this.context.createGain();
    this.oceanGain.gain.value = 0.34;
    noise.connect(this.filter);
    this.filter.connect(this.oceanGain);
    this.oceanGain.connect(this.master);
    noise.start();

    this.hum = this.context.createOscillator();
    this.hum.type = "triangle";
    this.hum.frequency.value = 52;
    this.harmonic = this.context.createOscillator();
    this.harmonic.type = "sine";
    this.harmonic.frequency.value = 104;
    this.humGain = this.context.createGain();
    this.humGain.gain.value = 0.018;
    this.hum.connect(this.humGain);
    this.harmonic.connect(this.humGain);
    this.humGain.connect(this.master);
    this.hum.start();
    this.harmonic.start();
  }

  async toggle() {
    this.init();
    if (!this.context) return false;
    if (this.context.state === "suspended") await this.context.resume();
    this.playing = !this.playing;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.playing ? 0.12 : 0, now, 0.25);
    return this.playing;
  }

  update(averageOutput, stability) {
    if (!this.context || !this.playing) return;
    const now = this.context.currentTime;
    const normalized = clamp((averageOutput - 36) / 22, 0, 1);
    const stabilityLift = clamp((stability - 60) / 40, 0, 1);
    this.hum.frequency.setTargetAtTime(48 + normalized * 22, now, 0.8);
    this.harmonic.frequency.setTargetAtTime(96 + normalized * 45, now, 0.8);
    this.humGain.gain.setTargetAtTime(0.014 + normalized * 0.026, now, 0.7);
    this.filter.frequency.setTargetAtTime(480 + normalized * 620 + stabilityLift * 160, now, 0.9);
    this.oceanGain.gain.setTargetAtTime(0.27 + normalized * 0.1, now, 0.7);
  }
}

const soundEngine = new SoundEngine();

function updateSoundButton() {
  const button = document.getElementById("soundBtn");
  button.setAttribute("aria-pressed", String(state.soundOn));
  button.querySelector("em").textContent = state.soundOn ? "开" : "关";
}

function minimumPairDistance(layout) {
  let minimum = Infinity;
  layout.forEach((a, index) => {
    layout.forEach((b, otherIndex) => {
      if (index === otherIndex) return;
      minimum = Math.min(minimum, Math.hypot(a.x - b.x, a.y - b.y));
    });
  });
  return minimum;
}

function comparisonCopy(a, b, winnerKey, loserKey) {
  const winner = winnerKey === "A" ? a : b;
  const loser = winnerKey === "A" ? b : a;
  const energyDelta = winner.annual - loser.annual;
  const energyPercent = loser.annual ? energyDelta / loser.annual * 100 : 0;
  const stabilityDelta = winner.stability - loser.stability;
  const wakeDelta = loser.wakeLoss - winner.wakeLoss;
  const spacingDelta = minimumPairDistance(state.schemes[winnerKey]) - minimumPairDistance(state.schemes[loserKey]);
  const parts = [];

  if (energyDelta > 0.2) {
    parts.push(`方案 ${winnerKey} 年发电量高 ${energyDelta.toFixed(1)} GWh（${formatSigned(energyPercent)}%）`);
  } else if (Math.abs(energyDelta) <= 0.2) {
    parts.push(`两种方案的年度发电量几乎持平`);
  } else {
    parts.push(`方案 ${winnerKey} 的收益优势来自稳定系数而非峰值发电量`);
  }

  if (wakeDelta > 0.15) {
    parts.push(`尾流损失低 ${wakeDelta.toFixed(1)} 个百分点`);
  }
  if (stabilityDelta > 0.3) {
    parts.push(`稳定系数高 ${stabilityDelta.toFixed(1)} 个百分点`);
  } else if (stabilityDelta < -0.3) {
    parts.push(`但稳定系数低 ${Math.abs(stabilityDelta).toFixed(1)} 个百分点`);
  }

  let reason;
  if (spacingDelta > 0.35) {
    reason = `较优方案的最小机组间距多出约 ${Math.round(spacingDelta * GRID.cellMeters)} m，并沿西北来风的垂直方向错开了机位，减少了后方机组落入上游尾流核心。`;
  } else if (wakeDelta > 0.2) {
    reason = `较优方案通过调整迎风次序与横向错位，让尾流扇区更多掠过网格边缘而不是扫向下一台机组。`;
  } else {
    reason = `较优方案在近岸可用网格内把四台机组分散到不同的尾流路径上，因此全年风向切换时的输出波动更小。`;
  }

  const final = `综合稳定系数与年度收益，推荐方案 ${winnerKey}。${reason}`;
  return {
    headline: `方案 ${winnerKey} 更适合持续发电`,
    narrative: `${parts.join("，")}。${final}`
  };
}

function buildComparison() {
  const metricsA = evaluateLayout(state.schemes.A);
  const metricsB = evaluateLayout(state.schemes.B);
  const winnerKey = metricsA.score >= metricsB.score ? "A" : "B";
  const loserKey = winnerKey === "A" ? "B" : "A";
  const copy = comparisonCopy(metricsA, metricsB, winnerKey, loserKey);
  const grid = document.getElementById("compareGrid");
  grid.innerHTML = "";

  ["A", "B"].forEach((key) => {
    const metrics = key === "A" ? metricsA : metricsB;
    const card = document.createElement("div");
    card.className = `compare-card${key === winnerKey ? " winner" : ""}`;
    card.innerHTML = `
      <div class="compare-card-head">
        <b>方案 ${key}</b>
        ${key === winnerKey ? '<span class="winner-tag">推荐</span>' : '<span class="mono-label" style="color:var(--faint)">REFERENCE</span>'}
      </div>
      <canvas class="compare-canvas" width="700" height="368" aria-label="方案 ${key} 布局图"></canvas>
      <div class="compare-metrics">
        <div><small>年发电量</small><b class="${key === winnerKey ? "accent" : ""}">${metrics.annual.toFixed(1)} GWh</b></div>
        <div><small>稳定系数</small><b>${metrics.stability.toFixed(0)}%</b></div>
        <div><small>尾流损失</small><b>${metrics.wakeLoss.toFixed(1)}%</b></div>
      </div>`;
    grid.appendChild(card);
    const canvas = card.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    drawMapScene(ctx, canvas.width, canvas.height, state.schemes[key], {
      compact: true,
      metrics,
      map: computeMapRect(canvas.width, canvas.height, true)
    });
  });

  document.getElementById("resultHeadline").textContent = copy.headline;
  document.getElementById("resultNarrative").textContent = copy.narrative;
  return { metricsA, metricsB, winnerKey, loserKey, copy };
}

function createMapImage(layout, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  drawMapScene(ctx, width, height, layout, {
    compact: true,
    metrics: evaluateLayout(layout),
    map: computeMapRect(width, height, true)
  });
  return canvas;
}

function drawPanelFrame(ctx, x, y, width, height, color = "rgba(143,226,201,.25)") {
  ctx.save();
  roundedRectPath(ctx, x, y, width, height, 10);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawExportBrand(ctx, width, subtitle) {
  ctx.save();
  ctx.fillStyle = "#06171c";
  ctx.fillRect(0, 0, width, 118);
  ctx.strokeStyle = "rgba(143,226,201,.24)";
  ctx.beginPath();
  ctx.moveTo(40, 93);
  ctx.lineTo(width - 40, 93);
  ctx.stroke();

  ctx.fillStyle = "#d8f57b";
  ctx.font = '600 16px "Ubuntu Sans", sans-serif';
  ctx.letterSpacing = "3px";
  ctx.fillText("TIDEFLOW", 42, 43);
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText("近海风场实验室", 42, 60);

  ctx.fillStyle = "#ecf5e9";
  ctx.font = '500 27px "Ubuntu Sans", sans-serif';
  ctx.fillText(subtitle, 42, 82);

  ctx.textAlign = "right";
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '10px "Ubuntu Mono", monospace';
  ctx.fillText("SITE 04 / NORTH BAY", width - 42, 40);
  ctx.fillText("GRID 400 m / 12 × 8", width - 42, 58);
  ctx.fillText("ANNUAL WIND · 300° NW", width - 42, 76);
  ctx.restore();
}

function drawLegendItem(ctx, x, y, color, text, square = false) {
  ctx.save();
  ctx.fillStyle = color;
  if (square) ctx.fillRect(x - 3, y - 3, 7, 7);
  else {
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText(text, x + 11, y + 3);
  ctx.restore();
}

function drawExportMetric(ctx, x, y, width, label, value, note, accent = "#ecf5e9") {
  ctx.save();
  ctx.fillStyle = "rgba(143,226,201,.055)";
  roundedRectPath(ctx, x, y, width, 61, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(143,226,201,.13)";
  ctx.stroke();
  ctx.fillStyle = "#6f8c89";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText(label, x + 13, y + 18);
  ctx.fillStyle = accent;
  ctx.font = '400 20px "Ubuntu Mono", monospace';
  ctx.fillText(value, x + 13, y + 43);
  if (note) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#587171";
    ctx.font = '8px "Ubuntu Sans", sans-serif';
    ctx.fillText(note, x + width - 12, y + 40);
  }
  ctx.restore();
}

function drawLayoutTable(ctx, x, y, width, layout) {
  ctx.save();
  ctx.fillStyle = "#6f8c89";
  ctx.font = '8px "Ubuntu Mono", monospace';
  ctx.fillText("UNIT", x, y);
  ctx.fillText("GRID X", x + width * 0.36, y);
  ctx.fillText("GRID Y", x + width * 0.58, y);
  ctx.fillText("HEADING", x + width * 0.79, y);
  ctx.strokeStyle = "rgba(143,226,201,.14)";
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.lineTo(x + width, y + 8);
  ctx.stroke();
  layout.forEach((turbine, index) => {
    const rowY = y + 27 + index * 24;
    ctx.fillStyle = "#dcece2";
    ctx.font = '10px "Ubuntu Mono", monospace';
    ctx.fillText(`WT-0${index + 1}`, x, rowY);
    ctx.fillStyle = "#8fa7a6";
    ctx.fillText(turbine.x.toFixed(1), x + width * 0.36, rowY);
    ctx.fillText(turbine.y.toFixed(1), x + width * 0.58, rowY);
    ctx.fillText(`${Math.round(turbine.angle)}°`, x + width * 0.79, rowY);
  });
  ctx.restore();
}

function addExportFooter(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(143,226,201,.16)";
  ctx.beginPath();
  ctx.moveTo(42, height - 58);
  ctx.lineTo(width - 42, height - 58);
  ctx.stroke();
  ctx.fillStyle = "#587171";
  ctx.font = '8px "Ubuntu Sans", sans-serif';
  const now = new Date();
  const dateText = now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  ctx.fillText(`生成于 ${dateText} · 九扇区年度风况 · 简化 Jensen 尾流模型`, 42, height - 34);
  ctx.textAlign = "right";
  ctx.fillText("TIDEFLOW FIELD REPORT / 04", width - 42, height - 34);
  ctx.restore();
}

function exportCurrentDiagram() {
  const width = 1480;
  const height = 980;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const metrics = evaluateLayout(activeLayout());
  ctx.fillStyle = "#071b22";
  ctx.fillRect(0, 0, width, height);
  drawExportBrand(ctx, width, `北湾近海风场 · 方案 ${state.activeScheme} 布局`);

  const mapImage = createMapImage(activeLayout(), 940, 690);
  ctx.drawImage(mapImage, 42, 145, 940, 690);
  drawPanelFrame(ctx, 42, 145, 940, 690, "rgba(143,226,201,.32)");

  const sideX = 1010;
  const sideW = 428;
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText("ANNUAL OUTPUT FORECAST", sideX, 162);
  ctx.fillStyle = "#ecf5e9";
  ctx.font = '400 52px "Ubuntu Mono", monospace';
  ctx.fillText(metrics.annual.toFixed(1), sideX, 218);
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '12px "Ubuntu Mono", monospace';
  ctx.fillText("GWh / YEAR", sideX + 165, 214);
  ctx.fillStyle = metrics.violations.length ? "#ff826f" : "#d8f57b";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText(metrics.violations.length ? `${metrics.violations.length} 台机组越界` : "全部机位通过空域校验", sideX, 242);

  drawExportMetric(ctx, sideX, 264, sideW, "稳定系数", `${metrics.stability.toFixed(1)}%`, "越高越好", "#d8f57b");
  drawExportMetric(ctx, sideX, 335, sideW, "尾流损失", `${metrics.wakeLoss.toFixed(1)}%`, "年度加权");
  drawExportMetric(ctx, sideX, 406, sideW, "最小禁布距离", `${Math.max(0, metrics.minimumClearance * GRID.cellMeters).toFixed(0)} m`, "缓冲带外");

  ctx.fillStyle = "#8fa7a6";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText("TURBINE POSITIONS", sideX, 502);
  drawLayoutTable(ctx, sideX, 522, sideW, activeLayout());

  drawLegendItem(ctx, sideX + 5, 650, "#d8f57b", "风机机位");
  drawLegendItem(ctx, sideX + 5, 672, "rgba(98,183,217,.8)", "尾流扇区");
  drawLegendItem(ctx, sideX + 150, 650, "#62b7d9", "主航道缓冲", true);
  drawLegendItem(ctx, sideX + 150, 672, "#ff826f", "鸟群迁徙带", true);

  ctx.strokeStyle = "rgba(143,226,201,.14)";
  ctx.beginPath();
  ctx.moveTo(42, 865);
  ctx.lineTo(width - 42, 865);
  ctx.stroke();
  ctx.fillStyle = "#6f8c89";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText("主导来风从西北进入，尾流向东南展开。机位越接近同一来风轴线，后方机组收到的尾流亏损越大。", 42, 893);
  addExportFooter(ctx, width, height);
  downloadCanvas(canvas, `tideflow-layout-${state.activeScheme}-${dateStamp()}.png`);
  showToast(`方案 ${state.activeScheme} 布局图已导出`);
}

function exportComparisonDiagram() {
  const result = buildComparison();
  const width = 1600;
  const height = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#071b22";
  ctx.fillRect(0, 0, width, height);
  drawExportBrand(ctx, width, "北湾近海风场 · 双方案年度比较");

  const panelW = 730;
  const mapH = 390;
  ["A", "B"].forEach((key, index) => {
    const metrics = key === "A" ? result.metricsA : result.metricsB;
    const x = 42 + index * (panelW + 56);
    const y = 142;
    const image = createMapImage(state.schemes[key], panelW, mapH);
    ctx.drawImage(image, x, y, panelW, mapH);
    drawPanelFrame(ctx, x, y, panelW, mapH, key === result.winnerKey ? "rgba(216,245,123,.68)" : "rgba(143,226,201,.25)");

    ctx.fillStyle = "#ecf5e9";
    ctx.font = '500 15px "Ubuntu Sans", sans-serif';
    ctx.fillText(`方案 ${key}`, x, y + mapH + 28);
    if (key === result.winnerKey) {
      ctx.fillStyle = "#15261f";
      roundedRectPath(ctx, x + 86, y + mapH + 16, 48, 17, 3);
      ctx.fill();
      ctx.fillStyle = "#d8f57b";
      ctx.font = '700 7px "Ubuntu Sans", sans-serif';
      ctx.fillText("推荐", x + 97, y + mapH + 27);
    }

    drawExportMetric(ctx, x, y + mapH + 42, 228, "年发电量", `${metrics.annual.toFixed(1)} GWh`, "");
    drawExportMetric(ctx, x + 245, y + mapH + 42, 228, "稳定系数", `${metrics.stability.toFixed(0)}%`, "");
    drawExportMetric(ctx, x + 490, y + mapH + 42, 240, "尾流损失", `${metrics.wakeLoss.toFixed(1)}%`, "");
  });

  ctx.fillStyle = "#d8f57b";
  ctx.font = '9px "Ubuntu Mono", monospace';
  ctx.fillText("SIMULATION VERDICT", 42, 742);
  ctx.fillStyle = "#ecf5e9";
  ctx.font = '500 20px "Ubuntu Sans", sans-serif';
  ctx.fillText(result.copy.headline, 42, 770);
  ctx.fillStyle = "#8fa7a6";
  ctx.font = '11px "Ubuntu Sans", sans-serif';
  wrapText(ctx, result.copy.narrative, 42, 798, width - 84, 20);

  ctx.strokeStyle = "rgba(143,226,201,.14)";
  ctx.beginPath();
  ctx.moveTo(42, 900);
  ctx.lineTo(width - 42, 900);
  ctx.stroke();
  ctx.fillStyle = "#6f8c89";
  ctx.font = '9px "Ubuntu Sans", sans-serif';
  ctx.fillText("评估口径：4 × 14 MW，年利用小时 3,860 h，九扇区加权风况；尾流模型用于玩法推演。", 42, 928);
  addExportFooter(ctx, width, height);
  downloadCanvas(canvas, `tideflow-comparison-${dateStamp()}.png`);
  showToast("A / B 对比布局图已导出");
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const characters = Array.from(text);
  let line = "";
  let cursorY = y;
  characters.forEach((character) => {
    const test = line + character;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
      line = character;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line, x, cursorY);
}

function dateStamp() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function downloadCanvas(canvas, filename) {
  const triggerDownload = (url) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (url.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(URL.createObjectURL(blob));
      else triggerDownload(canvas.toDataURL("image/png"));
    }, "image/png");
  } else {
    triggerDownload(canvas.toDataURL("image/png"));
  }
}

function bindPrimaryActions() {
  document.getElementById("soundBtn").addEventListener("click", async () => {
    try {
      const playing = await soundEngine.toggle();
      state.soundOn = playing;
      updateSoundButton();
      updateDashboard();
      showToast(playing ? "环境声已开启 · 音高随平均发电量变化" : "环境声已关闭");
    } catch (error) {
      console.warn("Audio could not start", error);
      showToast("当前浏览器无法启动环境声", true);
    }
  });

  document.getElementById("compareBtn").addEventListener("click", () => {
    buildComparison();
    openModal("resultsModal");
  });

  [document.getElementById("exportTopBtn"), document.getElementById("exportSideBtn")].forEach((button) => {
    button.addEventListener("click", exportCurrentDiagram);
  });
  document.getElementById("exportCompareBtn").addEventListener("click", exportComparisonDiagram);
}

function animationLoop(time) {
  renderMain(time);
  requestAnimationFrame(animationLoop);
}

function init() {
  buildUnitPicker();
  initMonthBars();
  bindInterface();
  bindPrimaryActions();
  resizeMapCanvas();
  drawWindRose();
  updateSoundButton();
  updateDashboard();
  requestAnimationFrame(animationLoop);
}

init();
