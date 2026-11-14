/* 潮汐可视化前端：Canvas 曲线、框选缩放、异常点点击、统计、PNG 导出。 */
(function () {
  "use strict";

  const canvas = document.getElementById("chart");
  const ctx = canvas.getContext("2d");
  const statsContent = document.getElementById("statsContent");
  const anomalyContent = document.getElementById("anomalyContent");
  const reportContent = document.getElementById("reportContent");

  const MARGIN = { top: 24, right: 24, bottom: 40, left: 64 };
  const COLOR_A = "#4da3ff";
  const COLOR_B = "#5fd68a";
  const COLOR_ANOM = "#ff5b45";

  const state = {
    points: [],
    report: null,
    view: null, // {t0, t1} 当前时间窗口；null 表示全量
    brush: null, // 拖拽中的框选 {x0, x1}
    hover: null,
  };

  // ---------- 坐标换算 ----------
  function plotRect() {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: MARGIN.left * dpr,
      y: MARGIN.top * dpr,
      w: canvas.width - (MARGIN.left + MARGIN.right) * dpr,
      h: canvas.height - (MARGIN.top + MARGIN.bottom) * dpr,
      dpr,
    };
  }

  function viewRange() {
    if (state.view) return state.view;
    const pts = state.points;
    return { t0: pts[0].t, t1: pts[pts.length - 1].t };
  }

  function yDomain() {
    const { t0, t1 } = viewRange();
    let lo = Infinity, hi = -Infinity;
    for (const p of state.points) {
      if (p.t < t0 || p.t > t1) continue;
      lo = Math.min(lo, p.a, p.b);
      hi = Math.max(hi, p.a, p.b);
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.12 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }

  function makeScales() {
    const r = plotRect();
    const { t0, t1 } = viewRange();
    const { lo, hi } = yDomain();
    const span = Math.max(t1 - t0, 1);
    return {
      x: (t) => r.x + ((t - t0) / span) * r.w,
      y: (v) => r.y + r.h - ((v - lo) / (hi - lo)) * r.h,
      invX: (px) => t0 + ((px - r.x) / r.w) * span,
      t0, t1, lo, hi, rect: r,
    };
  }

  // ---------- 渲染 ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 1100;
    const cssH = canvas.clientHeight || 460;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }

  function drawAxes(s) {
    const r = s.rect;
    ctx.strokeStyle = "#2a3a52";
    ctx.fillStyle = "#7f93ad";
    ctx.lineWidth = 1;
    ctx.font = `${11 * r.dpr}px sans-serif`;

    // 水平网格 + 水位刻度
    const yTicks = 6;
    for (let i = 0; i <= yTicks; i++) {
      const v = s.lo + ((s.hi - s.lo) * i) / yTicks;
      const y = s.y(v);
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(2) + " m", r.x - 8 * r.dpr, y + 4 * r.dpr);
    }

    // 垂直网格 + 时间刻度
    const xTicks = 8;
    for (let i = 0; i <= xTicks; i++) {
      const t = s.t0 + ((s.t1 - s.t0) * i) / xTicks;
      const x = s.x(t);
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
      ctx.textAlign = "center";
      const d = new Date(t);
      const label =
        `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ` +
        `${String(d.getUTCHours()).padStart(2, "0")}:00`;
      ctx.fillText(label, x, r.y + r.h + 18 * r.dpr);
    }
  }

  function drawSeries(s, key, color) {
    const { t0, t1 } = s;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 * s.rect.dpr;
    ctx.beginPath();
    let started = false;
    for (const p of state.points) {
      if (p.t < t0 || p.t > t1) continue;
      const x = s.x(p.t), y = s.y(p[key]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawMarkers(s) {
    const r = s.rect;
    for (const p of state.points) {
      if (p.t < s.t0 || p.t > s.t1) continue;
      for (const key of ["a", "b"]) {
        const anom = key === "a" ? p.aAnomaly : p.bAnomaly;
        const filled = key === "a" ? p.aFilled : p.bFilled;
        const x = s.x(p.t), y = s.y(p[key]);
        if (anom) {
          ctx.fillStyle = COLOR_ANOM;
          ctx.beginPath();
          ctx.arc(x, y, 5 * r.dpr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffd7d0";
          ctx.lineWidth = 1.2 * r.dpr;
          ctx.stroke();
        } else if (filled) {
          ctx.strokeStyle = key === "a" ? COLOR_A : COLOR_B;
          ctx.lineWidth = 1.2 * r.dpr;
          ctx.beginPath();
          ctx.arc(x, y, 3 * r.dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  function drawLegend() {
    const r = plotRect();
    ctx.font = `${12 * r.dpr}px sans-serif`;
    ctx.textAlign = "left";
    const items = [
      ["station_a", COLOR_A],
      ["station_b", COLOR_B],
      ["异常点", COLOR_ANOM],
    ];
    let x = r.x + 10 * r.dpr;
    for (const [label, color] of items) {
      ctx.fillStyle = color;
      ctx.fillRect(x, r.y + 6 * r.dpr, 14 * r.dpr, 4 * r.dpr);
      ctx.fillStyle = "#aebfd6";
      ctx.fillText(label, x + 20 * r.dpr, r.y + 12 * r.dpr);
      x += (20 + ctx.measureText(label).width / r.dpr + 26) * r.dpr;
    }
  }

  function drawBrush(s) {
    if (!state.brush) return;
    const r = s.rect;
    const x0 = Math.min(state.brush.x0, state.brush.x1);
    const w = Math.abs(state.brush.x1 - state.brush.x0);
    ctx.fillStyle = "rgba(120, 170, 255, 0.18)";
    ctx.fillRect(x0, r.y, w, r.h);
    ctx.strokeStyle = "rgba(150, 195, 255, 0.8)";
    ctx.strokeRect(x0, r.y, w, r.h);
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.points.length) return;
    const s = makeScales();
    drawAxes(s);
    drawSeries(s, "a", COLOR_A);
    drawSeries(s, "b", COLOR_B);
    drawMarkers(s);
    drawLegend();
    drawBrush(s);
    renderStats();
  }

  // ---------- 窗口统计 ----------
  function fmt(t) {
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }

  function renderStats() {
    const { t0, t1 } = viewRange();
    const win = state.points.filter((p) => p.t >= t0 && p.t <= t1);
    if (!win.length) {
      statsContent.innerHTML = '<span class="placeholder">当前窗口无数据</span>';
      return;
    }
    const stat = (key) => {
      let max = -Infinity, min = Infinity;
      for (const p of win) {
        max = Math.max(max, p[key]);
        min = Math.min(min, p[key]);
      }
      return { max, min };
    };
    const sa = stat("a"), sb = stat("b");
    let dMax = -Infinity, dMin = Infinity, dSum = 0;
    for (const p of win) {
      const d = p.a - p.b;
      dMax = Math.max(dMax, d);
      dMin = Math.min(dMin, d);
      dSum += d;
    }
    statsContent.innerHTML = `
      <table class="stats">
        <tr><th colspan="2">窗口：${fmt(t0)} ~ ${fmt(t1)}（${win.length} 点）</th></tr>
        <tr><td>station_a 最高水位</td><td>${sa.max.toFixed(3)} m</td></tr>
        <tr><td>station_a 最低水位</td><td>${sa.min.toFixed(3)} m</td></tr>
        <tr><td>station_b 最高水位</td><td>${sb.max.toFixed(3)} m</td></tr>
        <tr><td>station_b 最低水位</td><td>${sb.min.toFixed(3)} m</td></tr>
        <tr><td>两站差值 (a-b) 最大</td><td>${dMax.toFixed(3)} m</td></tr>
        <tr><td>两站差值 (a-b) 最小</td><td>${dMin.toFixed(3)} m</td></tr>
        <tr><td>两站差值 (a-b) 平均</td><td>${(dSum / win.length).toFixed(3)} m</td></tr>
      </table>`;
  }

  // ---------- 清洗报告 ----------
  function renderReport() {
    const r = state.report;
    if (!r) return;
    const item = (t) => fmt(t);
    reportContent.innerHTML = `
      <ul>
        <li>原始数据行：<b>${r.totalRows}</b>，清洗后：<b>${r.outputRows}</b></li>
        <li><span class="tag dup">重复</span>剔除 ${r.duplicatesRemoved.length} 条
          <ul>${r.duplicatesRemoved.map((d) =>
            `<li>${item(d.t)}：保留行 ${d.keptRow}，剔除行 ${d.removedRow}</li>`).join("")}
          </ul></li>
        <li><span class="tag miss">缺失</span>插值补齐 ${r.missingFilled.length} 处
          <ul>${r.missingFilled.map((m) =>
            `<li>${item(m.t)} ${m.station}（行 ${m.row}）→ ${m.value.toFixed(3)} m</li>`).join("")}
          </ul></li>
        <li><span class="tag anom">异常</span>标记 ${r.anomalies.length} 个
          <ul>${r.anomalies.map((a) =>
            `<li>${item(a.t)} ${a.station}（行 ${a.row}）= ${a.value.toFixed(3)} m</li>`).join("")}
          </ul></li>
        ${r.invalidRows.length ? `<li>无法解析 ${r.invalidRows.length} 行：
          ${r.invalidRows.map((x) => "行 " + x.row).join("、")}</li>` : ""}
      </ul>`;
  }

  // ---------- 交互：框选缩放 / 点击异常点 ----------
  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (e.clientX - rect.left) * dpr,
      y: (e.clientY - rect.top) * dpr,
    };
  }

  let dragStart = null;
  let dragged = false;

  canvas.addEventListener("mousedown", (e) => {
    if (!state.points.length) return;
    dragStart = canvasPos(e);
    dragged = false;
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!dragStart) return;
    const pos = canvasPos(e);
    if (Math.abs(pos.x - dragStart.x) > 4) dragged = true;
    if (dragged) {
      state.brush = { x0: dragStart.x, x1: pos.x };
      render();
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (!dragStart) return;
    const pos = canvasPos(e);
    if (dragged && state.brush) {
      const s = makeScales();
      const ta = s.invX(Math.min(state.brush.x0, state.brush.x1));
      const tb = s.invX(Math.max(state.brush.x0, state.brush.x1));
      if (tb - ta > 1000) {
        state.view = { t0: ta, t1: tb };
      }
    } else {
      handleClick(pos);
    }
    state.brush = null;
    dragStart = null;
    render();
  });

  canvas.addEventListener("mouseleave", () => {
    state.brush = null;
    dragStart = null;
    if (state.points.length) render();
  });

  canvas.addEventListener("dblclick", resetView);

  function handleClick(pos) {
    const s = makeScales();
    const radius = 10 * s.rect.dpr;
    let best = null;
    for (const p of state.points) {
      if (p.t < s.t0 || p.t > s.t1) continue;
      for (const key of ["a", "b"]) {
        const anom = key === "a" ? p.aAnomaly : p.bAnomaly;
        if (!anom) continue;
        const dx = s.x(p.t) - pos.x;
        const dy = s.y(p[key]) - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist < radius && (!best || dist < best.dist)) {
          best = { p, key, dist };
        }
      }
    }
    if (!best) {
      anomalyContent.innerHTML = '<span class="placeholder">未命中异常点，请点击红色标记</span>';
      return;
    }
    const { p, key } = best;
    const station = key === "a" ? "station_a" : "station_b";
    anomalyContent.innerHTML = `
      <b>异常点详情</b><br>
      站点：${station}<br>
      时间：${fmt(p.t)}<br>
      水位：${p[key].toFixed(3)} m<br>
      原始行号：第 <b>${p.row}</b> 行（CSV 含表头）<br>
      该点同时刻另一站：${(key === "a" ? p.b : p.a).toFixed(3)} m`;
  }

  function resetView() {
    state.view = null;
    render();
  }

  // ---------- 数据载入与导出 ----------
  function loadCSV(text, sourceName) {
    const { points, report } = TidalClean.clean(text);
    state.points = points;
    state.report = report;
    state.view = null;
    anomalyContent.innerHTML = '<span class="placeholder">点击图中的红色异常点</span>';
    renderReport();
    render();
    document.querySelector(".chart-hint").textContent =
      `已载入：${sourceName} · 拖拽框选时间窗口缩放 · 点击红色异常点查看原始行号 · 双击图表重置`;
  }

  document.getElementById("fileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadCSV(String(reader.result), file.name);
    reader.readAsText(file);
  });

  document.getElementById("sampleBtn").addEventListener("click", () => {
    loadCSV(SAMPLE_CSV, "内置样例（含乱序/缺失/重复）");
  });

  document.getElementById("resetBtn").addEventListener("click", resetView);

  document.getElementById("exportBtn").addEventListener("click", () => {
    if (!state.points.length) return;
    render(); // 确保最新帧
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "tidal-chart.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    render();
  });

  // 启动：自动载入内置样例
  resizeCanvas();
  loadCSV(SAMPLE_CSV, "内置样例（含乱序/缺失/重复）");
})();
