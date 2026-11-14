/* Canvas 绘图：原始曲线、异常区间、修复结果与悬浮提示 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TempChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = {
    band: 'rgba(255, 171, 64, 0.16)',
    bandBorder: 'rgba(230, 130, 20, 0.75)',
    raw: '#c0392b',
    repaired: '#1f77b4',
    grid: '#e6e8eb',
    text: '#5b6470',
    dot: '#e67e22'
  };

  const PADDING = { top: 18, right: 18, bottom: 34, left: 52 };

  function valueRange(points, key) {
    let min = Infinity;
    let max = -Infinity;
    points.forEach(function (p) {
      const v = p[key];
      if (v === null || v === undefined) return;
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (min === Infinity) return { min: 0, max: 1 };
    const pad = Math.max(1, (max - min) * 0.08);
    return { min: Math.floor(min - pad), max: Math.ceil(max + pad) };
  }

  function scales(canvas, points) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (canvas.width !== Math.round(cssWidth * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssWidth - PADDING.left - PADDING.right;
    const h = cssHeight - PADDING.top - PADDING.bottom;
    return {
      ctx: ctx, w: w, h: h,
      x: function (index) {
        return PADDING.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * w);
      },
      y: function (value, range) {
        return PADDING.top + h - ((value - range.min) / (range.max - range.min)) * h;
      }
    };
  }

  function drawGrid(ctx, sc, range, points) {
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;
    const steps = 5;
    for (let k = 0; k <= steps; k++) {
      const value = range.min + ((range.max - range.min) * k) / steps;
      const y = sc.y(value, range);
      ctx.beginPath();
      ctx.moveTo(PADDING.left, y);
      ctx.lineTo(PADDING.left + sc.w, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(1) + '°', PADDING.left - 8, y + 4);
    }
    const tickEvery = Math.ceil(points.length / 8);
    ctx.textAlign = 'center';
    points.forEach(function (p, i) {
      if (i % tickEvery !== 0) return;
      const label = p.time.slice(11, 16);
      ctx.fillText(label, sc.x(i), PADDING.top + sc.h + 18);
    });
  }

  function drawBands(ctx, sc, range, segments) {
    segments.forEach(function (seg) {
      const x1 = sc.x(seg.start) - 6;
      const x2 = sc.x(seg.end) + 6;
      ctx.fillStyle = COLORS.band;
      ctx.fillRect(x1, PADDING.top, x2 - x1, sc.h);
      ctx.strokeStyle = COLORS.bandBorder;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x1, PADDING.top, x2 - x1, sc.h);
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.bandBorder;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(seg.id, x1 + 4, PADDING.top + 13);
    });
  }

  function drawLine(ctx, sc, range, points, key, color, lineWidth, dashed) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath();
    let pen = false;
    points.forEach(function (p, i) {
      const v = p[key];
      if (v === null || v === undefined) { pen = false; return; }
      const x = sc.x(i);
      const y = sc.y(v, range);
      if (!pen) { ctx.moveTo(x, y); pen = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawReplacedDots(ctx, sc, range, points) {
    ctx.fillStyle = COLORS.dot;
    points.forEach(function (p, i) {
      if (p.status !== 'replaced' || p.repaired === null) return;
      ctx.beginPath();
      ctx.arc(sc.x(i), sc.y(p.repaired, range), 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function draw(canvas, points, segments, repairedPoints, options) {
    const opts = Object.assign({ showRaw: true }, options || {});
    const sc = scales(canvas, points);
    const ctx = sc.ctx;
    const range = valueRange(points, 'raw');
    const repairedRange = valueRange(repairedPoints, 'repaired');
    range.min = Math.min(range.min, repairedRange.min);
    range.max = Math.max(range.max, repairedRange.max);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawGrid(ctx, sc, range, points);
    drawBands(ctx, sc, range, segments);
    if (opts.showRaw) drawLine(ctx, sc, range, points, 'raw', COLORS.raw, 1.6, false);
    drawLine(ctx, sc, range, repairedPoints, 'repaired', COLORS.repaired, 2, false);
    drawReplacedDots(ctx, sc, range, repairedPoints);
    return { sc: sc, range: range };
  }

  function hitTest(canvas, event, sc, range, points) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < PADDING.left || x > PADDING.left + sc.w) return null;
    const ratio = (x - PADDING.left) / sc.w;
    const index = Math.round(ratio * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, index));
  }

  return {
    COLORS: COLORS, PADDING: PADDING,
    valueRange: valueRange, scales: scales,
    draw: draw, hitTest: hitTest
  };
});
