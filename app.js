const canvas = document.querySelector("#scene");
const ctx = canvas.getContext("2d");
const stage = canvas.closest(".stage-shell");

const ui = {
  undo: document.querySelector("#undoBtn"),
  redo: document.querySelector("#redoBtn"),
  export: document.querySelector("#exportBtn"),
  reset: document.querySelector("#resetBtn"),
  warning: document.querySelector("#warning"),
  warningText: document.querySelector("#warningText"),
  warningAction: document.querySelector("#warningAction"),
  lightX: document.querySelector("#lightX"),
  lightY: document.querySelector("#lightY"),
  lightXOutput: document.querySelector("#lightXOutput"),
  lightYOutput: document.querySelector("#lightYOutput"),
  positionOutput: document.querySelector("#positionOutput"),
  intensity: document.querySelector("#intensity"),
  intensityOutput: document.querySelector("#intensityOutput"),
  lightColor: document.querySelector("#lightColor"),
  colorName: document.querySelector("#colorName"),
  angleControls: document.querySelector("#angleControls"),
  historyStatus: document.querySelector("#historyStatus"),
  frameCount: document.querySelector("#frameCount"),
  lightCoordinates: document.querySelector("#lightCoordinates"),
  toast: document.querySelector("#toast"),
  liveRegion: document.querySelector("#liveRegion"),
};

const PANELS = [
  {
    id: "M-01",
    layer: 1,
    color: "#ff64d5",
    label: "品红",
    initialAngle: 139,
    length: 0.274,
    width: 0.071,
    offset: 0.051,
    depth: 0,
  },
  {
    id: "A-01",
    layer: 2,
    color: "#ffbd5c",
    label: "琥珀",
    initialAngle: -164,
    length: 0.304,
    width: 0.062,
    offset: 0.041,
    depth: 1,
  },
  {
    id: "A-02",
    layer: 2,
    color: "#ffbd5c",
    label: "琥珀",
    initialAngle: 18,
    length: 0.246,
    width: 0.055,
    offset: 0.046,
    depth: 2,
    flip: true,
  },
  {
    id: "C-01",
    layer: 3,
    color: "#5ff4e1",
    label: "青蓝",
    initialAngle: -89,
    length: 0.334,
    width: 0.062,
    offset: 0.045,
    depth: 3,
  },
  {
    id: "C-02",
    layer: 3,
    color: "#5ff4e1",
    label: "青蓝",
    initialAngle: -27,
    length: 0.281,
    width: 0.055,
    offset: 0.048,
    depth: 4,
    flip: true,
  },
];

const INITIAL_STATE = {
  angles: PANELS.map((panel) => panel.initialAngle),
  lightX: 28,
  lightY: 23,
  color: "#fff3d2",
  colorName: "暖白",
  intensity: 72,
};

const state = clone(INITIAL_STATE);
const history = {
  entries: [clone(state)],
  index: 0,
};

let viewport = { width: 1, height: 1, dpr: 1, unit: 1 };
let wallSurface = null;
let hoveredPanel = -1;
let activePanel = -1;
let dragOrigin = null;
let historyTimer = 0;
let toastTimer = 0;
let renderRequested = false;
let lastWarnings = { dark: false, overlap: false };
let frameIndex = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function radToDeg(radians) {
  return (radians * 180) / Math.PI;
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function formatAngle(angle) {
  const normalized = Math.round(((angle % 360) + 360) % 360);
  return normalized > 180 ? normalized - 360 : normalized;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = parseInt(full, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function rgba(hex, alpha) {
  const color = hexToRgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mixColors(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mix = {
    r: Math.round(lerp(a.r, b.r, amount)),
    g: Math.round(lerp(a.g, b.g, amount)),
    b: Math.round(lerp(a.b, b.b, amount)),
  };
  return `#${[mix.r, mix.g, mix.b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function colorBrightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function stateEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function getComposition() {
  const { width, height, unit } = viewport;
  return {
    hub: { x: width * 0.55, y: height * 0.525 },
    base: { x: width * 0.55, y: height * 0.825 },
    source: {
      x: width * (0.105 + (state.lightX / 100) * 0.285),
      y: height * (0.085 + (state.lightY / 100) * 0.46),
    },
    unit,
  };
}

function getPanelGeometry(index, time = 0) {
  const panel = PANELS[index];
  const composition = getComposition();
  const angle = degToRad(state.angles[index]);
  const length = panel.length * Math.min(viewport.width, viewport.height) * 1.04;
  const width = panel.width * Math.min(viewport.width, viewport.height);
  const offset = panel.offset * Math.min(viewport.width, viewport.height);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  const shimmer = Math.sin(time * 0.0013 + index * 1.7) * viewport.unit * 0.8;
  const start = {
    x: composition.hub.x + direction.x * offset,
    y: composition.hub.y + direction.y * offset,
  };
  const tip = {
    x: start.x + direction.x * length,
    y: start.y + direction.y * length,
  };
  const stemHalf = width * 0.45;
  const tipHalf = width * 0.28;
  const a = {
    x: start.x + normal.x * stemHalf,
    y: start.y + normal.y * stemHalf,
  };
  const b = {
    x: tip.x + normal.x * tipHalf,
    y: tip.y + normal.y * tipHalf,
  };
  const c = {
    x: tip.x - normal.x * tipHalf + direction.x * shimmer,
    y: tip.y - normal.y * tipHalf + direction.y * shimmer,
  };
  const d = {
    x: start.x - normal.x * stemHalf,
    y: start.y - normal.y * stemHalf,
  };
  const midpoint = {
    x: (start.x + tip.x) / 2,
    y: (start.y + tip.y) / 2,
  };
  return {
    index,
    panel,
    angle,
    length,
    width,
    direction,
    normal,
    start,
    tip,
    midpoint,
    points: [a, b, c, d],
    polygon: [a, b, c, d],
  };
}

function pointPolygonDistance(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 0.0001) + a.x;
    if (intersects) inside = !inside;
  }
  if (inside) return 0;
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (lengthSquared || 0.0001), 0, 1);
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    distance = Math.min(distance, Math.hypot(point.x - px, point.y - py));
  }
  return distance;
}

function projectPoint(point, source, distanceScale) {
  const dx = point.x - source.x;
  const dy = point.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / length) * distanceScale,
    y: point.y + (dy / length) * distanceScale,
  };
}

function projectionForPanel(geometry, composition) {
  const distance = Math.min(viewport.width, viewport.height) * 0.36;
  const rawCenter = projectPoint(geometry.midpoint, composition.source, distance);
  const nx = clamp((rawCenter.x / viewport.width - 0.34) / 0.98, 0, 1);
  const ny = clamp((rawCenter.y / viewport.height - 0.29) / 0.9, 0, 1);
  const center = {
    x: viewport.width * (0.68 + nx * 0.24),
    y: viewport.height * (0.18 + ny * 0.5),
  };
  const translation = {
    x: center.x - rawCenter.x,
    y: center.y - rawCenter.y,
  };
  const rawStart = projectPoint(geometry.start, composition.source, distance);
  const rawTip = projectPoint(geometry.tip, composition.source, distance);
  const start = { x: rawStart.x + translation.x, y: rawStart.y + translation.y };
  const tip = { x: rawTip.x + translation.x, y: rawTip.y + translation.y };
  const angle = Math.atan2(tip.y - start.y, tip.x - start.x);
  const length = Math.max(geometry.length * 0.48, viewport.unit * 80);
  const width = Math.max(geometry.width * 0.95, viewport.unit * 34);
  return {
    center,
    start,
    tip,
    angle,
    length,
    width,
    color: mixColors(geometry.panel.color, state.color, 0.1),
    intensity: state.intensity / 100,
  };
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWallSurface() {
  const { width, height, dpr } = viewport;
  const surface = document.createElement("canvas");
  surface.width = Math.max(1, Math.round(width * dpr));
  surface.height = Math.max(1, Math.round(height * dpr));
  const wall = surface.getContext("2d");
  wall.setTransform(dpr, 0, 0, dpr, 0, 0);
  const floorY = height * 0.78;
  const gradient = wall.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#12141b");
  gradient.addColorStop(0.48, "#1d1b23");
  gradient.addColorStop(1, "#28212a");
  wall.fillStyle = gradient;
  wall.fillRect(0, 0, width, height);

  const wallGlow = wall.createRadialGradient(width * 0.77, height * 0.28, 0, width * 0.77, height * 0.28, width * 0.52);
  wallGlow.addColorStop(0, "rgba(151, 119, 109, 0.10)");
  wallGlow.addColorStop(0.48, "rgba(110, 92, 104, 0.035)");
  wallGlow.addColorStop(1, "rgba(20, 20, 27, 0)");
  wall.fillStyle = wallGlow;
  wall.fillRect(0, 0, width, floorY);

  const floorGradient = wall.createLinearGradient(0, floorY, 0, height);
  floorGradient.addColorStop(0, "#17171d");
  floorGradient.addColorStop(0.25, "#1a191f");
  floorGradient.addColorStop(1, "#0e1116");
  wall.fillStyle = floorGradient;
  wall.fillRect(0, floorY, width, height - floorY);

  const lightPool = wall.createRadialGradient(width * 0.52, floorY + 4, 0, width * 0.52, floorY + 4, width * 0.42);
  lightPool.addColorStop(0, "rgba(124, 105, 117, 0.11)");
  lightPool.addColorStop(1, "rgba(20, 20, 26, 0)");
  wall.fillStyle = lightPool;
  wall.fillRect(0, floorY - height * 0.04, width, height - floorY + height * 0.04);

  wall.strokeStyle = "rgba(226, 218, 220, 0.09)";
  wall.lineWidth = 1;
  wall.beginPath();
  wall.moveTo(0, floorY + 0.5);
  wall.lineTo(width, floorY + 0.5);
  wall.stroke();
  wall.strokeStyle = "rgba(5, 7, 10, 0.25)";
  wall.beginPath();
  wall.moveTo(0, floorY + 4.5);
  wall.lineTo(width, floorY + 4.5);
  wall.stroke();

  const random = seededRandom(14803);
  const grainCount = Math.round((width * height) / 2500);
  for (let i = 0; i < grainCount; i++) {
    const x = random() * width;
    const y = random() * height;
    const size = 0.25 + random() * 1.15;
    const bright = random() > 0.61;
    wall.fillStyle = bright
      ? `rgba(242, 230, 228, ${0.012 + random() * 0.035})`
      : `rgba(2, 4, 8, ${0.018 + random() * 0.05})`;
    wall.fillRect(x, y, size, size);
  }

  for (let i = 0; i < 90; i++) {
    const x = random() * width;
    const y = random() * floorY;
    const length = 2 + random() * 15;
    wall.strokeStyle = random() > 0.5
      ? `rgba(241, 231, 228, ${0.008 + random() * 0.018})`
      : `rgba(6, 8, 12, ${0.012 + random() * 0.028})`;
    wall.lineWidth = 0.45 + random() * 0.65;
    wall.beginPath();
    wall.moveTo(x, y);
    wall.lineTo(x + (random() - 0.5) * 7, y + length);
    wall.stroke();
  }

  wall.strokeStyle = "rgba(234, 225, 225, 0.024)";
  wall.lineWidth = 0.65;
  for (let i = 0; i < 8; i++) {
    const startX = random() * width;
    const startY = random() * floorY * 0.8;
    wall.beginPath();
    wall.moveTo(startX, startY);
    let x = startX;
    let y = startY;
    for (let segment = 0; segment < 3 + Math.floor(random() * 4); segment++) {
      x += (random() - 0.45) * width * 0.06;
      y += random() * height * 0.035;
      wall.lineTo(x, y);
    }
    wall.stroke();
  }

  const floorRandom = seededRandom(90214);
  for (let i = 0; i < 160; i++) {
    const x = floorRandom() * width;
    const y = floorY + floorRandom() * (height - floorY);
    const length = 4 + floorRandom() * width * 0.09;
    wall.strokeStyle = `rgba(222, 214, 218, ${0.004 + floorRandom() * 0.013})`;
    wall.beginPath();
    wall.moveTo(x, y);
    wall.lineTo(x + length, y + (floorRandom() - 0.5) * 1.2);
    wall.stroke();
  }

  const vignette = wall.createRadialGradient(width * 0.52, height * 0.45, Math.min(width, height) * 0.18, width * 0.52, height * 0.45, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.7, "rgba(3, 5, 9, 0.09)");
  vignette.addColorStop(1, "rgba(2, 3, 6, 0.36)");
  wall.fillStyle = vignette;
  wall.fillRect(0, 0, width, height);

  return surface;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewport = {
    width,
    height,
    dpr,
    unit: Math.min(width, height) / 760,
  };
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wallSurface = buildWallSurface();
  requestRender();
}

function evaluateOptics() {
  const composition = getComposition();
  const geometry = PANELS.map((_, index) => getPanelGeometry(index));
  const projections = geometry.map((panel) => projectionForPanel(panel, composition));
  const brightness = colorBrightness(state.color) * (0.2 + (state.intensity / 100) * 0.8);
  const dark = brightness < 0.255;
  let overlapTotal = 0;
  let overlapPairs = 0;
  let maximumOverlap = 0;
  for (let i = 0; i < projections.length; i++) {
    for (let j = i + 1; j < projections.length; j++) {
      const a = projections[i];
      const b = projections[j];
      const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      const radius = (a.length + b.length) * 0.34;
      const overlap = clamp(1 - distance / Math.max(radius, 1), 0, 1);
      overlapTotal += overlap;
      maximumOverlap = Math.max(maximumOverlap, overlap);
      overlapPairs += 1;
    }
  }
  const meanOverlap = overlapTotal / Math.max(overlapPairs, 1);
  const overlap = meanOverlap > 0.62 && maximumOverlap > 0.82;
  return {
    composition,
    geometry,
    projections,
    brightness,
    overlap,
    meanOverlap,
    maximumOverlap,
    dark,
  };
}

function updateWarnings(result, force = false) {
  const next = { dark: result.dark, overlap: result.overlap };
  if (!force && next.dark === lastWarnings.dark && next.overlap === lastWarnings.overlap) return;
  const changed = next.dark !== lastWarnings.dark || next.overlap !== lastWarnings.overlap;
  lastWarnings = next;
  if (next.overlap) {
    ui.warningText.textContent = next.dark ? "投影重叠，且亮度偏低" : "折射光斑几乎完全重叠";
    ui.warningAction.textContent = "自动展开";
  } else if (next.dark) {
    ui.warningText.textContent = "墙面投影过暗";
    ui.warningAction.textContent = "提高浓度";
  }
  ui.warning.classList.toggle("visible", next.overlap || next.dark);
  if (changed) {
    ui.liveRegion.textContent = next.overlap
      ? "提示：投影几乎完全重叠"
      : next.dark
        ? "提示：墙面投影过暗"
        : "";
  }
}

function roundedPolygonPath(context, points) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.closePath();
}

function drawProjectionRibbon(geometry, projection) {
  const widthStart = geometry.width * 0.62;
  const widthEnd = projection.width * 0.55;
  const startNormal = {
    x: -Math.sin(projection.angle),
    y: Math.cos(projection.angle),
  };
  const a = {
    x: geometry.start.x - startNormal.x * widthStart,
    y: geometry.start.y - startNormal.y * widthStart,
  };
  const b = {
    x: projection.start.x - startNormal.x * widthEnd,
    y: projection.start.y - startNormal.y * widthEnd,
  };
  const c = {
    x: projection.tip.x + startNormal.x * widthEnd,
    y: projection.tip.y + startNormal.y * widthEnd,
  };
  const d = {
    x: geometry.tip.x + startNormal.x * widthStart,
    y: geometry.tip.y + startNormal.y * widthStart,
  };
  const gradient = ctx.createLinearGradient(geometry.start.x, geometry.start.y, projection.center.x, projection.center.y);
  const intensity = projection.intensity;
  gradient.addColorStop(0, rgba(projection.color, 0.045 * intensity));
  gradient.addColorStop(0.35, rgba(projection.color, 0.095 * intensity));
  gradient.addColorStop(0.78, rgba(projection.color, 0.21 * intensity));
  gradient.addColorStop(1, rgba(projection.color, 0.015 * intensity));
  roundedPolygonPath(ctx, [a, b, c, d]);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawCaustic(projection, time, index) {
  const intensity = projection.intensity;
  const pulse = 1 + Math.sin(time * 0.0009 + index * 2.1) * 0.025;
  const { center, length, width, angle, color } = projection;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  ctx.scale(pulse, 0.62);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, length * 0.5);
  glow.addColorStop(0, rgba("#ffffff", 0.62 * intensity));
  glow.addColorStop(0.07, rgba(color, 0.7 * intensity));
  glow.addColorStop(0.3, rgba(color, 0.42 * intensity));
  glow.addColorStop(0.68, rgba(color, 0.15 * intensity));
  glow.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, length * 0.5, 0, Math.PI * 2);
  ctx.fill();

  for (let band = 0; band < 4; band++) {
    const offset = (band - 1.5) * width * 0.18;
    const alpha = (0.27 - band * 0.032) * intensity;
    ctx.strokeStyle = band === 1 ? rgba("#ffffff", alpha * 1.2) : rgba(color, alpha);
    ctx.lineWidth = Math.max(0.7, viewport.unit * (1.4 - band * 0.18));
    ctx.beginPath();
    ctx.moveTo(-length * 0.34, offset + Math.sin(time * 0.001 + band) * width * 0.08);
    ctx.bezierCurveTo(-length * 0.12, offset - width * 0.1, length * 0.12, offset + width * 0.12, length * 0.34, offset);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(color, 0.26 * intensity);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, length * 0.44, width * 0.26, 0, 0, Math.PI * 2);
  ctx.stroke();

  for (let spot = 0; spot < 3; spot++) {
    const spotX = (spot - 1) * length * 0.18;
    const spotY = Math.sin(time * 0.0014 + spot * 1.9 + index) * width * 0.1;
    const hot = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, width * 0.16);
    hot.addColorStop(0, rgba("#ffffff", 0.35 * intensity));
    hot.addColorStop(0.35, rgba(color, 0.24 * intensity));
    hot.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(spotX, spotY, width * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let arc = 0; arc < 3; arc++) {
    ctx.strokeStyle = arc === 1 ? rgba("#ffffff", 0.28 * intensity) : rgba(color, 0.32 * intensity);
    ctx.lineWidth = Math.max(0.7, viewport.unit * (1.1 - arc * 0.2));
    ctx.beginPath();
    ctx.ellipse(
      -length * (0.07 + arc * 0.045),
      0,
      length * (0.25 + arc * 0.06),
      width * (0.17 + arc * 0.045),
      arc * 0.14,
      -0.8,
      1.1,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawProjections(result, time) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  result.projections.forEach((projection, index) => {
    drawProjectionRibbon(result.geometry[index], projection);
  });
  result.projections.forEach((projection, index) => {
    drawCaustic(projection, time, index);
  });
  result.projections.forEach((projection, index) => {
    const { center, color } = projection;
    const radius = Math.max(2, viewport.unit * 2.8);
    const halo = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 6);
    halo.addColorStop(0, rgba("#ffffff", 0.18));
    halo.addColorStop(0.2, rgba(color, 0.14));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 6, 0, Math.PI * 2);
    ctx.fill();
    if (index === 0) {
      ctx.strokeStyle = "rgba(239, 250, 246, 0.14)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(center.x - radius * 2, center.y);
      ctx.lineTo(center.x + radius * 2, center.y);
      ctx.moveTo(center.x, center.y - radius * 2);
      ctx.lineTo(center.x, center.y + radius * 2);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function drawWallDetails(result, time) {
  const { composition, projections } = result;
  const { width, height } = viewport;
  const light = composition.source;
  const halo = ctx.createRadialGradient(light.x, light.y, 0, light.x, light.y, Math.min(width, height) * 0.28);
  halo.addColorStop(0, rgba(state.color, 0.12 * (state.intensity / 100)));
  halo.addColorStop(0.42, rgba(state.color, 0.025));
  halo.addColorStop(1, rgba(state.color, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height * 0.78);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  result.geometry.forEach((geometry, index) => {
    const target = geometry.midpoint;
    const ray = ctx.createLinearGradient(light.x, light.y, target.x, target.y);
    ray.addColorStop(0, rgba(state.color, 0.16));
    ray.addColorStop(0.45, rgba(geometry.panel.color, 0.055));
    ray.addColorStop(1, rgba(geometry.panel.color, 0));
    ctx.strokeStyle = ray;
    ctx.lineWidth = Math.max(1, viewport.unit * (1.1 + index * 0.09));
    ctx.beginPath();
    ctx.moveTo(light.x, light.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  projections.forEach((projection, index) => {
    const { start, tip, color } = projection;
    const gradient = ctx.createLinearGradient(start.x, start.y, tip.x, tip.y);
    gradient.addColorStop(0, rgba(color, 0));
    gradient.addColorStop(0.5, rgba(color, 0.04 + index * 0.006));
    gradient.addColorStop(1, rgba(color, 0.01));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawFloorShadow(result) {
  const { base } = result.composition;
  const { unit } = viewport;
  const shadow = ctx.createRadialGradient(base.x, base.y + unit * 6, 0, base.x, base.y + unit * 6, unit * 150);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.42)");
  shadow.addColorStop(0.38, "rgba(0, 0, 0, 0.23)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shadow;
  ctx.save();
  ctx.translate(base.x, base.y + unit * 7);
  ctx.scale(1, 0.23);
  ctx.beginPath();
  ctx.arc(0, 0, unit * 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPedestal(result, time) {
  const { base, hub } = result.composition;
  const unit = viewport.unit;
  const baseWidth = Math.min(viewport.width * 0.22, unit * 130);
  const baseHeight = baseWidth * 0.33;

  ctx.save();
  ctx.translate(base.x, base.y);
  const rim = ctx.createLinearGradient(0, -baseHeight * 0.6, 0, baseHeight * 0.65);
  rim.addColorStop(0, "rgba(177, 185, 188, 0.22)");
  rim.addColorStop(0.23, "rgba(58, 62, 67, 0.85)");
  rim.addColorStop(0.74, "rgba(19, 22, 27, 0.95)");
  rim.addColorStop(1, "rgba(4, 6, 9, 0.95)");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(0, 0, baseWidth * 0.5, baseHeight * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(218, 226, 227, 0.20)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.fillStyle = "rgba(210, 218, 220, 0.08)";
  ctx.beginPath();
  ctx.ellipse(0, -baseHeight * 0.13, baseWidth * 0.44, baseHeight * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(238, 244, 244, 0.13)";
  ctx.beginPath();
  ctx.ellipse(0, -baseHeight * 0.13, baseWidth * 0.4, baseHeight * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const poleTop = hub.y + unit * 25;
  const poleBottom = base.y - unit * 8;
  const poleGradient = ctx.createLinearGradient(base.x - 8, 0, base.x + 8, 0);
  poleGradient.addColorStop(0, "rgba(16, 18, 22, 0.95)");
  poleGradient.addColorStop(0.42, "rgba(170, 176, 180, 0.6)");
  poleGradient.addColorStop(0.56, "rgba(86, 91, 96, 0.65)");
  poleGradient.addColorStop(1, "rgba(7, 9, 12, 0.96)");
  ctx.strokeStyle = poleGradient;
  ctx.lineWidth = Math.max(2, unit * 4);
  ctx.beginPath();
  ctx.moveTo(base.x, poleBottom);
  ctx.lineTo(hub.x, poleTop);
  ctx.stroke();
  ctx.strokeStyle = "rgba(235, 245, 248, 0.20)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(base.x - unit * 0.8, poleBottom);
  ctx.lineTo(hub.x - unit * 0.8, poleTop);
  ctx.stroke();

  const basePulse = 0.5 + Math.sin(time * 0.0014) * 0.1;
  ctx.fillStyle = `rgba(95, 244, 225, ${basePulse * 0.36})`;
  ctx.beginPath();
  ctx.arc(base.x, base.y - baseHeight * 0.1, Math.max(1.2, unit * 1.5), 0, Math.PI * 2);
  ctx.fill();
}

function drawPanelShadow(geometry) {
  ctx.save();
  ctx.translate(viewport.unit * 9, viewport.unit * 14);
  ctx.filter = `blur(${Math.max(3, viewport.unit * 8)}px)`;
  ctx.fillStyle = "rgba(0, 0, 0, 0.20)";
  roundedPolygonPath(ctx, geometry.points);
  ctx.fill();
  ctx.restore();
}

function panelPoint(geometry, t, offset) {
  const center = {
    x: lerp(geometry.start.x, geometry.tip.x, t),
    y: lerp(geometry.start.y, geometry.tip.y, t),
  };
  return {
    x: center.x + geometry.normal.x * offset,
    y: center.y + geometry.normal.y * offset,
  };
}

function drawPanel(geometry, time, isHovered, isActive) {
  const { panel, points, start, tip, width, angle, midpoint } = geometry;
  const unit = viewport.unit;
  const alpha = 0.76 + panel.depth * 0.045 + (isHovered || isActive ? 0.12 : 0);
  const color = panel.color;
  const gradient = ctx.createLinearGradient(points[3].x, points[3].y, points[0].x, points[0].y);
  gradient.addColorStop(0, rgba("#ffffff", 0.025 * alpha));
  gradient.addColorStop(0.08, rgba(color, 0.56 * alpha));
  gradient.addColorStop(0.25, rgba(color, 0.22 * alpha));
  gradient.addColorStop(0.52, rgba("#ffffff", 0.09 * alpha));
  gradient.addColorStop(0.72, rgba(color, 0.17 * alpha));
  gradient.addColorStop(0.93, rgba(color, 0.48 * alpha));
  gradient.addColorStop(1, rgba("#ffffff", 0.05 * alpha));

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  roundedPolygonPath(ctx, points);
  ctx.fillStyle = gradient;
  ctx.fill();

  const inner = points.map((point) => ({
    x: lerp(point.x, midpoint.x, 0.08),
    y: lerp(point.y, midpoint.y, 0.08),
  }));
  roundedPolygonPath(ctx, inner);
  ctx.fillStyle = rgba(color, 0.055 * alpha);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedPolygonPath(ctx, points);
  ctx.strokeStyle = rgba(color, 0.68);
  ctx.lineWidth = Math.max(0.65, unit * 0.9);
  ctx.stroke();

  const leadingEdge = ctx.createLinearGradient(start.x, start.y, tip.x, tip.y);
  leadingEdge.addColorStop(0, rgba("#ffffff", 0.22));
  leadingEdge.addColorStop(0.44, rgba("#ffffff", 0.64));
  leadingEdge.addColorStop(0.7, rgba(color, 0.95));
  leadingEdge.addColorStop(1, rgba("#ffffff", 0.48));
  ctx.strokeStyle = leadingEdge;
  ctx.lineWidth = Math.max(1, unit * 1.45);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.stroke();

  ctx.strokeStyle = rgba("#ffffff", 0.20);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(points[3].x, points[3].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.stroke();

  for (let stripe = 0; stripe < 6; stripe++) {
    const u = -0.68 + stripe * 0.27;
    const from = panelPoint(geometry, 0.12, u * width * 0.4);
    const to = panelPoint(geometry, 0.88, u * width * 0.4);
    const shine = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    shine.addColorStop(0, rgba("#ffffff", 0));
    shine.addColorStop(0.45 + stripe * 0.035, rgba("#ffffff", 0.16 + stripe * 0.012));
    shine.addColorStop(0.66, rgba(color, 0.20));
    shine.addColorStop(1, rgba("#ffffff", 0));
    ctx.strokeStyle = shine;
    ctx.lineWidth = Math.max(0.45, unit * (0.55 + (stripe % 2) * 0.35));
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  const cut = panelPoint(geometry, 0.64, width * 0.04);
  const cutNormal = panelPoint(geometry, 0.64, width * 0.46);
  ctx.strokeStyle = rgba("#ffffff", 0.28);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cut.x, cut.y);
  ctx.lineTo(cutNormal.x, cutNormal.y);
  ctx.stroke();

  const grip = panelPoint(geometry, 0.76, width * 0.16);
  const hoverBoost = isHovered || isActive ? 1 : 0.68;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(angle);
  ctx.strokeStyle = rgba("#ffffff", 0.45 * hoverBoost);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(3.1, unit * 4.1), 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba(color, 0.65 * hoverBoost);
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.2, unit * 1.4), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  let textAngle = angle;
  if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
  const labelPoint = panelPoint(geometry, 0.31, width * (panel.flip ? -0.62 : 0.62));
  ctx.save();
  ctx.translate(labelPoint.x, labelPoint.y);
  ctx.rotate(textAngle);
  ctx.fillStyle = rgba("#ffffff", 0.53);
  ctx.font = `500 ${Math.max(5.2, unit * 6.4)}px "Ubuntu Sans Mono", monospace`;
  ctx.letterSpacing = "0.06em";
  ctx.textBaseline = "middle";
    ctx.fillText(`${panel.id}  ${formatAngle(state.angles[geometry.index])}°`, 0, 0);
  ctx.restore();

  if (isHovered || isActive) {
    ctx.save();
    roundedPolygonPath(ctx, points);
    ctx.strokeStyle = rgba("#ffffff", isActive ? 0.78 : 0.5);
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.setLineDash(isActive ? [] : [3, 4]);
    ctx.stroke();
    ctx.restore();
  }

  if (panel.depth >= 3) {
    const tipGlow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, width * 0.9);
    tipGlow.addColorStop(0, rgba(color, 0.46));
    tipGlow.addColorStop(1, rgba(color, 0));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = tipGlow;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, width * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHub(result, time) {
  const { hub } = result.composition;
  const unit = viewport.unit;
  const radius = Math.max(13, unit * 22);
  ctx.save();
  ctx.translate(hub.x, hub.y);
  const metal = ctx.createLinearGradient(-radius, -radius, radius, radius);
  metal.addColorStop(0, "rgba(224, 231, 232, 0.55)");
  metal.addColorStop(0.18, "rgba(40, 44, 49, 0.98)");
  metal.addColorStop(0.62, "rgba(9, 12, 16, 0.98)");
  metal.addColorStop(1, "rgba(124, 132, 138, 0.44)");
  ctx.fillStyle = metal;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(235, 243, 244, 0.27)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.strokeStyle = "rgba(228, 239, 241, 0.12)";
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
  ctx.stroke();

  PANELS.forEach((panel, index) => {
    const startAngle = degToRad(state.angles[index]) - 0.11;
    ctx.strokeStyle = rgba(panel.color, 0.7);
    ctx.lineWidth = Math.max(1, unit * 1.15);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.81, startAngle, startAngle + 0.17);
    ctx.stroke();
  });

  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.58);
  const pulse = 0.45 + Math.sin(time * 0.0018) * 0.08;
  core.addColorStop(0, `rgba(243, 255, 251, ${pulse})`);
  core.addColorStop(0.28, "rgba(95, 244, 225, 0.25)");
  core.addColorStop(1, "rgba(95, 244, 225, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(228, 238, 240, 0.18)";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(hub.x, hub.y, radius + unit * 8.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSculpture(result, time) {
  const sorted = [...result.geometry].sort((a, b) => a.panel.depth - b.panel.depth);
  sorted.forEach(drawPanelShadow);
  sorted.forEach((geometry, index) => {
    const hovered = geometry.index === hoveredPanel;
    const active = geometry.index === activePanel;
    drawPanel(geometry, time + index * 120, hovered, active);
  });
  drawHub(result, time);
}

function drawLightSource(result, time) {
  const { source } = result.composition;
  const unit = viewport.unit;
  const radius = clamp(Math.min(viewport.width, viewport.height) * 0.027, 8, 17);
  const pulse = 1 + Math.sin(time * 0.002) * 0.07;
  const glow = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, radius * 5.5);
  glow.addColorStop(0, rgba("#ffffff", 0.85));
  glow.addColorStop(0.08, rgba(state.color, 0.8));
  glow.addColorStop(0.2, rgba(state.color, 0.22));
  glow.addColorStop(0.6, rgba(state.color, 0.055));
  glow.addColorStop(1, rgba(state.color, 0));
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(source.x, source.y, radius * 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(source.x, source.y);
  ctx.rotate(time * 0.00011);
  for (let ring = 0; ring < 3; ring++) {
    ctx.strokeStyle = rgba(state.color, 0.19 - ring * 0.04);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * (2.1 + ring * 0.78) * pulse, radius * (1.25 + ring * 0.48), ring * 0.36, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = rgba("#ffffff", 0.96);
  ctx.shadowColor = state.color;
  ctx.shadowBlur = radius * 3;
  ctx.beginPath();
  ctx.arc(source.x, source.y, radius * 0.23, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const ringColor = hoveredPanel === -2 ? "rgba(255, 255, 255, 0.72)" : rgba(state.color, 0.42);
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.arc(source.x, source.y, radius * 1.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(231, 242, 244, 0.45)";
  ctx.font = `500 ${Math.max(5.4, unit * 6.5)}px "Ubuntu Sans Mono", monospace`;
  ctx.letterSpacing = "0.09em";
  ctx.textAlign = "center";
  ctx.fillText(`LIGHT ${pad(state.lightX)} / ${pad(state.lightY)}`, source.x, source.y + radius * 3.15);
  ctx.textAlign = "left";
}

function drawForeground(result, time) {
  const { width, height, unit } = viewport;
  const dustRandom = seededRandom(5481);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 28; i++) {
    const x = dustRandom() * width;
    const y = height * 0.14 + dustRandom() * height * 0.63;
    const alpha = 0.018 + dustRandom() * 0.06;
    const size = 0.35 + dustRandom() * 0.9;
    const drift = Math.sin(time * 0.00025 + i) * unit * 1.8;
    ctx.fillStyle = `rgba(236, 249, 247, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x + drift, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const leftShade = ctx.createLinearGradient(0, 0, width * 0.13, 0);
  leftShade.addColorStop(0, "rgba(4, 6, 10, 0.2)");
  leftShade.addColorStop(1, "rgba(4, 6, 10, 0)");
  ctx.fillStyle = leftShade;
  ctx.fillRect(0, 0, width * 0.13, height);
}

function render(time = 0) {
  renderRequested = false;
  const result = evaluateOptics();
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  if (wallSurface) {
    ctx.drawImage(wallSurface, 0, 0, viewport.width, viewport.height);
  }
  drawWallDetails(result, time);
  drawProjections(result, time);
  drawFloorShadow(result);
  drawPedestal(result, time);
  drawSculpture(result, time);
  drawLightSource(result, time);
  drawForeground(result, time);
  updateWarnings(result);
}

function requestRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame((time) => {
    if (document.hidden) {
      renderRequested = false;
      return;
    }
    render(time);
  });
}

function animate(time) {
  render(time);
  requestAnimationFrame(animate);
}

function buildAngleControls() {
  const fragment = document.createDocumentFragment();
  PANELS.forEach((panel, index) => {
    const row = document.createElement("label");
    row.className = "angle-row";
    row.dataset.panel = String(index);
    row.innerHTML = `
      <span class="angle-dot" style="color:${panel.color};background:${panel.color}"></span>
      <span class="angle-label">${panel.id}</span>
      <input id="angle${index}" type="range" min="-180" max="180" step="1" value="${state.angles[index]}" aria-label="${panel.label}镜片角度">
      <output class="angle-value" for="angle${index}">${formatAngle(state.angles[index])}°</output>
    `;
    fragment.appendChild(row);
  });
  ui.angleControls.appendChild(fragment);
}

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const progress = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--progress", `${progress}%`);
}

function syncUI() {
  ui.lightX.value = state.lightX;
  ui.lightY.value = state.lightY;
  ui.intensity.value = state.intensity;
  ui.lightColor.value = state.color;
  ui.lightXOutput.value = state.lightX;
  ui.lightYOutput.value = state.lightY;
  ui.positionOutput.value = `${pad(state.lightX)} / ${pad(state.lightY)}`;
  ui.intensityOutput.value = `${state.intensity}%`;
  ui.colorName.textContent = state.colorName;
  ui.lightCoordinates.textContent = `LIGHT · X ${pad(state.lightX)} / Y ${pad(state.lightY)}`;
  [ui.lightX, ui.lightY, ui.intensity].forEach(paintRange);

  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    const active = swatch.dataset.color.toLowerCase() === state.color.toLowerCase();
    swatch.classList.toggle("active", active);
    swatch.setAttribute("aria-pressed", String(active));
  });

  PANELS.forEach((_, index) => {
    const input = document.querySelector(`#angle${index}`);
    const output = input.parentElement.querySelector(".angle-value");
    input.value = state.angles[index];
    output.value = `${formatAngle(state.angles[index])}°`;
    paintRange(input);
  });
  updateHistoryUI();
}

function updateHistoryUI() {
  ui.undo.disabled = history.index <= 0;
  ui.redo.disabled = history.index >= history.entries.length - 1;
  ui.historyStatus.textContent = `${pad(history.index + 1)} / ${pad(history.entries.length)}`;
  ui.frameCount.textContent = pad(history.index + 1, 3);
}

function flushHistory() {
  if (!historyTimer) return;
  clearTimeout(historyTimer);
  historyTimer = 0;
  commitHistory();
}

function commitHistory() {
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = 0;
  }
  if (stateEquals(state, history.entries[history.index])) return;
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push(clone(state));
  history.index = history.entries.length - 1;
  if (history.entries.length > 80) {
    history.entries.shift();
    history.index -= 1;
  }
  frameIndex = history.index + 1;
  updateHistoryUI();
  ui.liveRegion.textContent = `已记录第 ${history.index + 1} 个画面`;
}

function scheduleHistory() {
  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = window.setTimeout(() => {
    historyTimer = 0;
    commitHistory();
  }, 160);
}

function setState(next) {
  Object.assign(state, next);
  syncUI();
  requestRender();
}

function undo() {
  flushHistory();
  if (history.index <= 0) return;
  history.index -= 1;
  frameIndex = history.index + 1;
  Object.assign(state, clone(history.entries[history.index]));
  syncUI();
  requestRender();
  showToast(`已撤销 · 画面 ${pad(history.index + 1, 3)}`);
  ui.liveRegion.textContent = `已撤销到画面 ${history.index + 1}`;
}

function redo() {
  flushHistory();
  if (history.index >= history.entries.length - 1) return;
  history.index += 1;
  frameIndex = history.index + 1;
  Object.assign(state, clone(history.entries[history.index]));
  syncUI();
  requestRender();
  showToast(`已重做 · 画面 ${pad(history.index + 1, 3)}`);
  ui.liveRegion.textContent = `已重做到画面 ${history.index + 1}`;
}

function resetScene() {
  flushHistory();
  Object.assign(state, clone(INITIAL_STATE));
  syncUI();
  requestRender();
  commitHistory();
  showToast("光学参数已重置");
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast.classList.remove("visible");
  }, 1900);
}

function applyAngle(index, value, commit = false) {
  state.angles[index] = clamp(Number(value), -180, 180);
  syncUI();
  requestRender();
  if (commit) commitHistory();
  else scheduleHistory();
}

function updateLightFromControls() {
  state.lightX = Number(ui.lightX.value);
  state.lightY = Number(ui.lightY.value);
  syncUI();
  requestRender();
  scheduleHistory();
}

function updateIntensity() {
  state.intensity = Number(ui.intensity.value);
  syncUI();
  requestRender();
  scheduleHistory();
}

function setLightColor(color, name = "自定义") {
  state.color = color.toLowerCase();
  state.colorName = name;
  syncUI();
  requestRender();
  scheduleHistory();
}

function automaticCorrection() {
  flushHistory();
  if (lastWarnings.overlap) {
    const spread = [-164, -89, -27, 18, 139];
    const available = [...spread];
    state.angles = state.angles.map(() => {
      const candidate = available.shift();
      return candidate ?? state.angles[0];
    });
    syncUI();
    requestRender();
    commitHistory();
    showToast("镜片已重新展开");
  } else if (lastWarnings.dark) {
    state.intensity = clamp(Math.max(58, state.intensity + 24), 8, 100);
    syncUI();
    requestRender();
    commitHistory();
    showToast("光束浓度已提高");
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function panelAtPoint(point) {
  const optics = evaluateOptics();
  return optics.geometry
    .slice()
    .sort((a, b) => b.panel.depth - a.panel.depth)
    .find((geometry) => pointPolygonDistance(point, geometry.polygon) <= Math.max(7, viewport.unit * 9));
}

function sourceAtPoint(point) {
  const { source } = getComposition();
  return Math.hypot(point.x - source.x, point.y - source.y) < Math.max(22, viewport.unit * 30);
}

function pointerMove(event) {
  const point = canvasPoint(event);
  if (dragOrigin?.type === "panel") {
    const { hub } = getComposition();
    const current = Math.atan2(point.y - hub.y, point.x - hub.x);
    let delta = radToDeg(current - dragOrigin.pointerAngle);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    state.angles[dragOrigin.panel] = clamp(dragOrigin.angle + delta, -180, 180);
    syncUI();
    requestRender();
    return;
  }
  if (dragOrigin?.type === "source") {
    const { width, height } = viewport;
    state.lightX = Math.round(clamp(((point.x / width - 0.105) / 0.285) * 100, 8, 88));
    state.lightY = Math.round(clamp(((point.y / height - 0.085) / 0.46) * 100, 8, 58));
    syncUI();
    requestRender();
    return;
  }
  if (sourceAtPoint(point)) {
    hoveredPanel = -2;
    canvas.style.cursor = "move";
    requestRender();
    return;
  }
  const target = panelAtPoint(point);
  const nextHovered = target ? target.index : -1;
  canvas.style.cursor = target ? "grab" : "default";
  if (nextHovered !== hoveredPanel) {
    hoveredPanel = nextHovered;
    requestRender();
  }
}

function pointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  const point = canvasPoint(event);
  if (sourceAtPoint(point)) {
    dragOrigin = { type: "source" };
    activePanel = -2;
    hoveredPanel = -2;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const target = panelAtPoint(point);
  if (!target) return;
  const { hub } = getComposition();
  dragOrigin = {
    type: "panel",
    panel: target.index,
    angle: state.angles[target.index],
    pointerAngle: Math.atan2(point.y - hub.y, point.x - hub.x),
  };
  activePanel = target.index;
  hoveredPanel = target.index;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture?.(event.pointerId);
  requestRender();
  event.preventDefault();
}

function pointerUp(event) {
  if (!dragOrigin) return;
  dragOrigin = null;
  activePanel = -1;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  commitHistory();
  pointerMove(event);
}

function pointerCancel(event) {
  if (!dragOrigin) return;
  dragOrigin = null;
  activePanel = -1;
  hoveredPanel = -1;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  commitHistory();
  requestRender();
}

function exportFrame() {
  render(performance.now());
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.download = `refract-frame-${pad(frameIndex, 3)}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast(`画面已导出 · ${pad(frameIndex, 3)} / PNG`);
  ui.liveRegion.textContent = "当前画面已导出为 PNG";
  return dataUrl;
}

function bindEvents() {
  ui.undo.addEventListener("click", undo);
  ui.redo.addEventListener("click", redo);
  ui.reset.addEventListener("click", resetScene);
  ui.export.addEventListener("click", exportFrame);
  ui.warningAction.addEventListener("click", automaticCorrection);

  ui.lightX.addEventListener("input", updateLightFromControls);
  ui.lightY.addEventListener("input", updateLightFromControls);
  ui.intensity.addEventListener("input", updateIntensity);
  ui.lightColor.addEventListener("input", () => {
    setLightColor(ui.lightColor.value, "自定义");
  });

  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      flushHistory();
      setLightColor(swatch.dataset.color, swatch.dataset.name);
      commitHistory();
    });
  });

  ui.angleControls.addEventListener("input", (event) => {
    if (!event.target.matches('input[type="range"]')) return;
    const row = event.target.closest(".angle-row");
    applyAngle(Number(row.dataset.panel), event.target.value);
  });
  ui.angleControls.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="range"]')) return;
    commitHistory();
  });

  [ui.lightX, ui.lightY, ui.intensity].forEach((input) => {
    input.addEventListener("change", commitHistory);
  });

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("pointerleave", () => {
    if (dragOrigin) return;
    if (hoveredPanel !== -1) {
      hoveredPanel = -1;
      canvas.style.cursor = "default";
      requestRender();
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  window.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "Escape" && dragOrigin) {
      pointerCancel({ pointerId: 0 });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestRender();
  });
}

function initialize() {
  buildAngleControls();
  bindEvents();
  syncUI();
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(stage);
  } else {
    window.addEventListener("resize", resizeCanvas);
  }
  resizeCanvas();
  requestAnimationFrame(animate);
}

window.__refract = {
  getState: () => clone(state),
  getOptics: () => {
    const result = evaluateOptics();
    return {
      dark: result.dark,
      overlap: result.overlap,
      brightness: result.brightness,
      meanOverlap: result.meanOverlap,
      maximumOverlap: result.maximumOverlap,
      history: { index: history.index, length: history.entries.length },
    };
  },
  exportDataUrl: () => {
    render(performance.now());
    return canvas.toDataURL("image/png");
  },
  flushHistory,
  undo,
  redo,
};

initialize();
