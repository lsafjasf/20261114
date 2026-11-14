/*
 * render.js — 全部基于 Canvas 2D 实时绘制：
 * 曲线编辑区（含可拖拽控制点）、小球运动轨道、位移/速度/加速度图
 */
(function (global) {
  'use strict';

  var PADDING = 26;

  function fitCanvas(canvas) {
    var dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function plotArea(size) {
    return {
      x: PADDING, y: PADDING,
      w: size.w - PADDING * 2,
      h: size.h - PADDING * 2
    };
  }

  function drawGrid(ctx, area) {
    ctx.strokeStyle = '#e3e6ee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 0; i <= 4; i++) {
      var gx = area.x + area.w * i / 4;
      var gy = area.y + area.h * i / 4;
      ctx.moveTo(gx, area.y); ctx.lineTo(gx, area.y + area.h);
      ctx.moveTo(area.x, gy); ctx.lineTo(area.x + area.w, gy);
    }
    ctx.stroke();
    ctx.strokeStyle = '#9aa3b2';
    ctx.strokeRect(area.x, area.y, area.w, area.h);
  }

  function toX(area, u) { return area.x + area.w * u; }
  function toY(area, v) { return area.y + area.h * (1 - v); }

  function strokeCurve(ctx, area, easing, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    var steps = 120;
    for (var i = 0; i <= steps; i++) {
      var u = i / steps;
      var px = toX(area, u);
      var py = toY(area, easing.valueAt(u));
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  /* 曲线编辑区：五条曲线 + 自定义曲线的两个控制点 + 控制柄 + 时间游标 */
  function drawCurveEditor(canvas, opts) {
    var size = fitCanvas(canvas);
    var ctx = size.ctx;
    var area = plotArea(size);
    ctx.clearRect(0, 0, size.w, size.h);
    drawGrid(ctx, area);

    opts.curves.forEach(function (item) {
      var active = item.id === opts.driverId || item.id === opts.compareId;
      ctx.globalAlpha = active ? 1 : 0.35;
      strokeCurve(ctx, area, item.easing, item.color, active ? 2.6 : 1.2);
      ctx.globalAlpha = 1;
    });

    /* 自定义曲线的贝塞尔控制柄与控制点 */
    var p = opts.controlPoints;
    var c1 = { x: toX(area, p[0]), y: toY(area, p[1]) };
    var c2 = { x: toX(area, p[2]), y: toY(area, p[3]) };
    var p0 = { x: toX(area, 0), y: toY(area, 0) };
    var p3 = { x: toX(area, 1), y: toY(area, 1) };
    ctx.strokeStyle = '#e08214';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(c1.x, c1.y);
    ctx.moveTo(p3.x, p3.y); ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
    ctx.setLineDash([]);
    [c1, c2].forEach(function (pt, idx) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, idx === opts.dragIndex ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = idx === opts.dragIndex ? '#b35c00' : '#f5a623';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (typeof opts.timeCursor === 'number') {
      var cx = toX(area, opts.timeCursor);
      ctx.strokeStyle = 'rgba(40,48,70,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, area.y);
      ctx.lineTo(cx, area.y + area.h);
      ctx.stroke();
    }
    return { area: area, c1: c1, c2: c2 };
  }

  var renderApi = {
    fitCanvas: fitCanvas,
    plotArea: plotArea,
    drawGrid: drawGrid,
    toX: toX,
    toY: toY,
    strokeCurve: strokeCurve,
    drawCurveEditor: drawCurveEditor
  };

  /* 小球轨道：水平轨道 + 两条对比曲线各自驱动的小球（实时按曲线取值） */
  function drawTrack(canvas, opts) {
    var size = fitCanvas(canvas);
    var ctx = size.ctx;
    var area = plotArea(size);
    ctx.clearRect(0, 0, size.w, size.h);
    var trackY = area.y + area.h / 2;

    ctx.strokeStyle = '#c7ccd8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(area.x, trackY);
    ctx.lineTo(area.x + area.w, trackY);
    ctx.stroke();

    ctx.fillStyle = '#8a93a5';
    ctx.font = '11px sans-serif';
    ctx.fillText('0%', area.x - 4, trackY + 22);
    ctx.fillText('100%', area.x + area.w - 26, trackY + 22);

    opts.balls.forEach(function (ball) {
      var bx = toX(area, Math.max(0, Math.min(1, ball.progress)));
      var by = trackY + (ball.lane || 0);
      ctx.beginPath();
      ctx.arc(bx, by, ball.ghost ? 11 : 14, 0, Math.PI * 2);
      ctx.fillStyle = ball.color;
      ctx.globalAlpha = ball.ghost ? 0.55 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#3a4256';
      ctx.font = '11px sans-serif';
      ctx.fillText(ball.label, bx - 18, by - (ball.ghost ? 18 : 22));
    });
  }

  /* 数据图通用绘制：series=[{samples, key, color, label}]，自适应纵轴 */
  function drawGraph(canvas, title, series, key, cursorU) {
    var size = fitCanvas(canvas);
    var ctx = size.ctx;
    var area = plotArea(size);
    ctx.clearRect(0, 0, size.w, size.h);
    drawGrid(ctx, area);

    var minV = Infinity, maxV = -Infinity;
    series.forEach(function (s) {
      s.samples.forEach(function (pt) {
        if (pt[key] < minV) minV = pt[key];
        if (pt[key] > maxV) maxV = pt[key];
      });
    });
    if (minV === maxV) { minV -= 1; maxV += 1; }
    var pad = (maxV - minV) * 0.08;
    minV -= pad; maxV += pad;
    if (key === 's') { minV = 0; maxV = 1; }

    function mapY(v) {
      return area.y + area.h * (1 - (v - minV) / (maxV - minV));
    }

    series.forEach(function (s) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      s.samples.forEach(function (pt, i) {
        var px = toX(area, pt.u);
        var py = mapY(pt[key]);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    if (typeof cursorU === 'number') {
      var cx = toX(area, cursorU);
      ctx.strokeStyle = 'rgba(40,48,70,0.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, area.y);
      ctx.lineTo(cx, area.y + area.h);
      ctx.stroke();
    }

    ctx.fillStyle = '#3a4256';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(title, area.x, area.y - 9);
    ctx.font = '10px sans-serif';
    ctx.fillText(
      'min ' + minV.toFixed(2) + '   max ' + maxV.toFixed(2),
      area.x, area.y + area.h + 18
    );
  }

  renderApi.drawTrack = drawTrack;
  renderApi.drawGraph = drawGraph;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = renderApi;
  } else {
    global.EasingRender = renderApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
