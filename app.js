"use strict";

/* ================= 数据模型：内置样例 =================
 * 街区范围固定为 0..100 x 0..70 的本地坐标（公里缩放），
 * 所有图层共用同一 project()，保证切换图层/时间时空间位置不漂移。
 */
const WORLD = { w: 100, h: 70 };
const GRID = { nx: 50, ny: 35 };          // 采样网格
const HOURS = 24;

// 确定性伪随机，保证每次加载样例一致
function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// 三个随时间漂移的涡旋中心（世界坐标）
function vortices(hour) {
  const t = (hour / HOURS) * Math.PI * 2;
  return [
    { x: 30 + 14 * Math.cos(t), y: 24 + 10 * Math.sin(t), s: 1.6, r: 22 },
    { x: 68 + 10 * Math.cos(t + 2.1), y: 46 + 12 * Math.sin(t + 2.1), s: -1.3, r: 18 },
    { x: 50 + 18 * Math.cos(t + 4.2), y: 18 + 8 * Math.sin(t + 4.2), s: 1.0, r: 14 },
  ];
}

// 解析风场：背景流 + 日变化 + 涡旋叠加，返回 {u, v}（m/s）
function windAt(wx, wy, hour) {
  const t = (hour / HOURS) * Math.PI * 2;
  const diurnal = 1.0 + 0.9 * Math.sin(t - Math.PI / 3); // 午后风大、凌晨风小
  let u = 2.2 * diurnal + 0.6 * Math.sin(wy * 0.11 + t);
  let v = 0.9 * Math.cos(wx * 0.07 - t * 0.7);
  for (const c of vortices(hour)) {
    const dx = wx - c.x, dy = wy - c.y;
    const d2 = dx * dx + dy * dy;
    const fall = Math.exp(-d2 / (c.r * c.r));
    u += -dy * c.s * fall * 0.35;
    v += dx * c.s * fall * 0.35;
  }
  return { u, v };
}

// 预生成 24 小时网格数据：field[hour][j][i] = {u, v, speed}
const FIELD = [];
let GLOBAL_MIN = Infinity, GLOBAL_MAX = -Infinity;
for (let h = 0; h < HOURS; h++) {
  const rows = [];
  for (let j = 0; j < GRID.ny; j++) {
    const row = [];
    for (let i = 0; i < GRID.nx; i++) {
      const wx = (i / (GRID.nx - 1)) * WORLD.w;
      const wy = (j / (GRID.ny - 1)) * WORLD.h;
      const { u, v } = windAt(wx, wy, h);
      const speed = Math.hypot(u, v);
      row.push({ u, v, speed });
      if (speed < GLOBAL_MIN) GLOBAL_MIN = speed;
      if (speed > GLOBAL_MAX) GLOBAL_MAX = speed;
    }
    rows.push(row);
  }
  FIELD.push(rows);
}

// 双线性插值取任意世界坐标的风（供流线与悬浮查询）
function sampleWind(wx, wy, hour) {
  const gx = Math.min(Math.max(wx / WORLD.w, 0), 1) * (GRID.nx - 1);
  const gy = Math.min(Math.max(wy / WORLD.h, 0), 1) * (GRID.ny - 1);
  const i0 = Math.floor(gx), j0 = Math.floor(gy);
  const i1 = Math.min(i0 + 1, GRID.nx - 1), j1 = Math.min(j0 + 1, GRID.ny - 1);
  const fx = gx - i0, fy = gy - j0;
  const g = FIELD[hour];
  const a = g[j0][i0], b = g[j0][i1], c = g[j1][i0], d = g[j1][i1];
  const u = a.u * (1 - fx) * (1 - fy) + b.u * fx * (1 - fy) + c.u * (1 - fx) * fy + d.u * fx * fy;
  const v = a.v * (1 - fx) * (1 - fy) + b.v * fx * (1 - fy) + c.v * (1 - fx) * fy + d.v * fx * fy;
  return { u, v, speed: Math.hypot(u, v) };
}

/* ================= 固定投影 =================
 * 世界坐标 -> 画布像素，唯一映射来源，所有图层复用。
 */
const VIEW = { w: 880, h: 600, pad: 30 };
function project(wx, wy) {
  const sx = (VIEW.w - VIEW.pad * 2) / WORLD.w;
  const sy = (VIEW.h - VIEW.pad * 2) / WORLD.h;
  return {
    x: VIEW.pad + wx * sx,
    y: VIEW.h - VIEW.pad - wy * sy, // y 轴向上
  };
}
function unproject(px, py) {
  const sx = (VIEW.w - VIEW.pad * 2) / WORLD.w;
  const sy = (VIEW.h - VIEW.pad * 2) / WORLD.h;
  return {
    x: (px - VIEW.pad) / sx,
    y: (VIEW.h - VIEW.pad - py) / sy,
  };
}

/* ================= 街区轮廓（内置样例） =================
 * 矩形建筑地块，世界坐标；街道即地块间隙。
 */
const BLOCKS = [];
(function buildBlocks() {
  const rows = [
    { y0: 4, y1: 18 }, { y0: 24, y1: 40 }, { y0: 46, y1: 62 },
  ];
  const cols = [
    { x0: 4, x1: 16 }, { x0: 22, x1: 36 }, { x0: 42, x1: 58 },
    { x0: 64, x1: 78 }, { x0: 84, x1: 96 },
  ];
  rows.forEach((r, rj) => {
    cols.forEach((c, ci) => {
      if (hash2(rj, ci) < 0.12) return; // 留几个空地当公园
      const shrink = 1 + hash2(ci, rj) * 2;
      BLOCKS.push({
        x0: c.x0 + shrink, y0: r.y0 + shrink,
        x1: c.x1 - shrink, y1: r.y1 - shrink,
      });
    });
  });
})();

function drawBlocks(ctx) {
  ctx.save();
  for (const b of BLOCKS) {
    const p0 = project(b.x0, b.y1);
    const p1 = project(b.x1, b.y0);
    ctx.fillStyle = "rgba(52, 66, 84, 0.55)";
    ctx.strokeStyle = "rgba(140, 160, 185, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}


function drawFrame(ctx) {
  const p0 = project(0, WORLD.h);
  const p1 = project(WORLD.w, 0);
  ctx.save();
  ctx.strokeStyle = "rgba(120, 140, 160, 0.5)";
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(160, 175, 190, 0.9)";
  ctx.font = "12px sans-serif";
  ctx.fillText("街区范围 100km × 70km（内置样例）", p0.x + 6, p0.y + 16);
  ctx.restore();
}

/* ================= 颜色标尺 =================
 * 各图层独立量程配置，切换图层时图例同步重绘。
 */
const SCALES = {
  heat:   { label: "风速热区 (m/s)", stops: [[0, "#1a2f6b"], [0.25, "#1f8ac0"], [0.5, "#3fc1a0"], [0.75, "#f2d544"], [1, "#e4483c"]] },
  arrow:  { label: "风速箭头 (m/s)", stops: [[0, "#2b6cb0"], [0.5, "#38b2ac"], [1, "#ed8936"]] },
  stream: { label: "流线段风速 (m/s)", stops: [[0, "#35507a"], [0.5, "#4cc9c0"], [1, "#ffd166"]] },
};

function colorFor(scaleName, t) {
  const stops = SCALES[scaleName].stops;
  const c = Math.min(Math.max(t, 0), 1);
  for (let k = 0; k < stops.length - 1; k++) {
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1];
    if (c >= p0 && c <= p1) {
      const f = (c - p0) / (p1 - p0 || 1);
      const a = parseInt(c0.slice(1), 16), b = parseInt(c1.slice(1), 16);
      const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * f;
      const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * f;
      const bl = (a & 255) + ((b & 255) - (a & 255)) * f;
      return `rgb(${r | 0},${g | 0},${bl | 0})`;
    }
  }
  return stops[stops.length - 1][1];
}

function normSpeed(speed) {
  return (speed - GLOBAL_MIN) / (GLOBAL_MAX - GLOBAL_MIN || 1);
}

/* ================= 图层绘制 =================
 * 统一入口 drawScene(ctx, layer, hour)，主画布与导出/对比共用。
 */
function drawScene(ctx, layer, hour, view) {
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.fillStyle = "#0c1118";
  ctx.fillRect(0, 0, view.w, view.h);
  if (layer === "heat") drawHeat(ctx, hour);
  drawBlocks(ctx);
  if (layer === "arrow") drawArrows(ctx, hour);
  if (layer === "stream") drawStreams(ctx, hour);
  drawFrame(ctx);
  drawTimestamp(ctx, hour, view);
}

function drawTimestamp(ctx, hour, view) {
  ctx.save();
  ctx.fillStyle = "rgba(223, 230, 238, 0.95)";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText(`时刻 ${String(hour).padStart(2, "0")}:00`, view.w - 120, 26);
  ctx.restore();
}

// --- 热区：低分辨率离屏画布按网格着色，再放大平滑 ---
const heatCanvas = document.createElement("canvas");
heatCanvas.width = GRID.nx;
heatCanvas.height = GRID.ny;

function drawHeat(ctx, hour) {
  const hctx = heatCanvas.getContext("2d");
  const img = hctx.createImageData(GRID.nx, GRID.ny);
  for (let j = 0; j < GRID.ny; j++) {
    for (let i = 0; i < GRID.nx; i++) {
      const s = FIELD[hour][j][i].speed;
      const rgb = colorFor("heat", normSpeed(s)).match(/\d+/g).map(Number);
      // 网格 j 向上，像素行向下，需翻转
      const idx = ((GRID.ny - 1 - j) * GRID.nx + i) * 4;
      img.data[idx] = rgb[0];
      img.data[idx + 1] = rgb[1];
      img.data[idx + 2] = rgb[2];
      img.data[idx + 3] = 200;
    }
  }
  hctx.putImageData(img, 0, 0);
  const p0 = project(0, WORLD.h);
  const p1 = project(WORLD.w, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(heatCanvas, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
  ctx.restore();
}

// --- 箭头：规则格点，方向=风向，长度与颜色=风速 ---
function drawArrows(ctx, hour) {
  const step = 5; // 世界坐标间隔
  ctx.save();
  ctx.lineWidth = 1.6;
  for (let wy = step / 2; wy < WORLD.h; wy += step) {
    for (let wx = step / 2; wx < WORLD.w; wx += step) {
      const { u, v, speed } = sampleWind(wx, wy, hour);
      const p = project(wx, wy);
      const ang = Math.atan2(-v, u); // 画布 y 向下
      const len = 6 + normSpeed(speed) * 14;
      const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      ctx.strokeStyle = colorFor("arrow", normSpeed(speed));
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(p.x - dx / 2, p.y - dy / 2);
      ctx.lineTo(p.x + dx / 2, p.y + dy / 2);
      ctx.stroke();
      // 箭头头部
      ctx.beginPath();
      ctx.moveTo(p.x + dx / 2, p.y + dy / 2);
      ctx.lineTo(p.x + dx / 2 - Math.cos(ang - 0.45) * 5, p.y + dy / 2 - Math.sin(ang - 0.45) * 5);
      ctx.lineTo(p.x + dx / 2 - Math.cos(ang + 0.45) * 5, p.y + dy / 2 - Math.sin(ang + 0.45) * 5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// --- 流线：从固定种子点做 RK 积分，按段风速着色 ---
function drawStreams(ctx, hour) {
  const seeds = [];
  const n = 16;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // 固定种子 + 微抖动（抖动只依赖坐标，不随时间变，避免位置漂移感）
      const wx = ((i + 0.5) / n) * WORLD.w + (hash2(i, j) - 0.5) * 2;
      const wy = ((j + 0.5) / n) * WORLD.h + (hash2(j, i) - 0.5) * 2;
      seeds.push({ x: wx, y: wy });
    }
  }
  ctx.save();
  ctx.lineWidth = 1.4;
  for (const seed of seeds) {
    let x = seed.x, y = seed.y;
    const dt = 0.9;
    for (let k = 0; k < 60; k++) {
      const w0 = sampleWind(x, y, hour);
      if (w0.speed < 0.05) break;
      const nx = x + (w0.u / w0.speed) * dt;
      const ny = y + (w0.v / w0.speed) * dt;
      if (nx < 0 || nx > WORLD.w || ny < 0 || ny > WORLD.h) break;
      const p0 = project(x, y), p1 = project(nx, ny);
      ctx.strokeStyle = colorFor("stream", normSpeed(w0.speed));
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      x = nx; y = ny;
    }
  }
  ctx.restore();
}

/* ================= 图例（随图层同步更新） ================= */
const legendCanvas = document.getElementById("legend");

function drawLegend(layer) {
  const ctx = legendCanvas.getContext("2d");
  const { w, h } = { w: legendCanvas.width, h: legendCanvas.height };
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1118";
  ctx.fillRect(0, 0, w, h);
  const scale = SCALES[layer];
  const barX = 18, barW = 22, barY = 40, barH = h - 110;
  for (let y = 0; y < barH; y++) {
    ctx.fillStyle = colorFor(layer, 1 - y / (barH - 1));
    ctx.fillRect(barX, barY + y, barW, 1);
  }
  ctx.strokeStyle = "#3b4a5c";
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = "#dfe6ee";
  ctx.font = "11px sans-serif";
  ctx.save();
  ctx.translate(14, h / 2 + 60);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(scale.label, 0, 0);
  ctx.restore();
  ctx.fillText(GLOBAL_MAX.toFixed(1), barX + barW + 6, barY + 10);
  ctx.fillText(((GLOBAL_MIN + GLOBAL_MAX) / 2).toFixed(1), barX + barW + 6, barY + barH / 2 + 4);
  ctx.fillText(GLOBAL_MIN.toFixed(1), barX + barW + 6, barY + barH);
  ctx.fillStyle = "#9fb0c1";
  ctx.fillText("m/s", barX + barW + 6, barY + barH + 18);
}

/* ================= 交互与状态 ================= */
const state = { layer: "stream", hour: 8, pins: [6, 12, 18] };
const mapCanvas = document.getElementById("map");
const mapCtx = mapCanvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const timeSlider = document.getElementById("timeSlider");
const timeLabel = document.getElementById("timeLabel");

function render() {
  drawScene(mapCtx, state.layer, state.hour, VIEW);
  drawLegend(state.layer);
  timeLabel.textContent = `${String(state.hour).padStart(2, "0")}:00`;
  timeSlider.value = state.hour;
  renderSlots();
}

document.getElementById("layerBtns").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  state.layer = btn.dataset.layer;
  document.querySelectorAll("#layerBtns button").forEach((b) =>
    b.classList.toggle("active", b === btn)
  );
  render(); // 图层切换 -> 图例同步重绘，投影不变
});

timeSlider.addEventListener("input", () => {
  state.hour = Number(timeSlider.value);
  render();
});

mapCanvas.addEventListener("mousemove", (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const w = unproject(px, py);
  if (w.x < 0 || w.x > WORLD.w || w.y < 0 || w.y > WORLD.h) {
    tooltip.classList.add("hidden");
    return;
  }
  const s = sampleWind(w.x, w.y, state.hour);
  const dirDeg = ((Math.atan2(-s.v, s.u) * 180) / Math.PI + 360) % 360;
  tooltip.innerHTML =
    `位置 (${w.x.toFixed(1)}, ${w.y.toFixed(1)}) km<br>` +
    `时刻 ${String(state.hour).padStart(2, "0")}:00<br>` +
    `风速 ${s.speed.toFixed(2)} m/s<br>` +
    `风向 ${dirDeg.toFixed(0)}°`;
  tooltip.style.left = `${px + 14}px`;
  tooltip.style.top = `${py + 14}px`;
  tooltip.classList.remove("hidden");
});
mapCanvas.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));

/* ================= 三时段对比与导出 ================= */
const slotsEl = document.getElementById("slots");

function renderSlots() {
  slotsEl.innerHTML = "";
  state.pins.forEach((h, idx) => {
    const d = document.createElement("div");
    d.className = "slot" + (h === null ? "" : " filled");
    d.textContent = h === null ? `时段${idx + 1}` : `${String(h).padStart(2, "0")}:00`;
    d.title = "点击清除该时段";
    d.addEventListener("click", () => {
      state.pins[idx] = null;
      renderSlots();
    });
    slotsEl.appendChild(d);
  });
}

document.getElementById("pinBtn").addEventListener("click", () => {
  const idx = state.pins.findIndex((p) => p === null);
  if (idx === -1) {
    state.pins.shift();
    state.pins.push(state.hour);
  } else {
    state.pins[idx] = state.hour;
  }
  renderSlots();
});

function download(canvas, name) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = name;
  a.click();
}

document.getElementById("exportBtn").addEventListener("click", () => {
  download(mapCanvas, `wind_${state.layer}_${String(state.hour).padStart(2, "0")}00.png`);
});

document.getElementById("exportCompareBtn").addEventListener("click", () => {
  const hours = state.pins.map((p, i) => (p === null ? [6, 12, 18][i] : p));
  const gap = 12, labelH = 30;
  const out = document.createElement("canvas");
  out.width = VIEW.w * 3 + gap * 4;
  out.height = VIEW.h + labelH + gap * 2;
  const octx = out.getContext("2d");
  octx.fillStyle = "#10151c";
  octx.fillRect(0, 0, out.width, out.height);
  hours.forEach((h, i) => {
    const ox = gap + i * (VIEW.w + gap);
    const oy = gap + labelH;
    octx.fillStyle = "#dfe6ee";
    octx.font = "bold 15px sans-serif";
    octx.fillText(`时段 ${String(h).padStart(2, "0")}:00 · 图层 ${layerName(state.layer)}`, ox, oy - 10);
    const tile = document.createElement("canvas");
    tile.width = VIEW.w;
    tile.height = VIEW.h;
    drawScene(tile.getContext("2d"), state.layer, h, VIEW);
    octx.drawImage(tile, ox, oy);
  });
  download(out, `wind_compare_${hours.map((h) => String(h).padStart(2, "0")).join("-")}.png`);
});

function layerName(key) {
  return { stream: "流线", arrow: "箭头", heat: "热区" }[key] || key;
}

render();
