/* 曲线关键帧编辑器：三个通道共用一块 canvas，拖动圆点直接改曲线。 */
(function () {
  "use strict";
  const HH = (window.HH = window.HH || globalThis.HH || {}); globalThis.HH = HH;

  const PAD_L = 56;
  const PAD_R = 18;
  const PAD_T = 18;
  const PAD_B = 34;
  const HIT_R = 9;

  function sorted(points) {
    return points.sort((a, b) => a.t - b.t);
  }

  HH.CurveEditor = function CurveEditor(canvas, config, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.config = config;
    this.onChange = onChange || function () {};
    this.channel = "pan";
    this.selected = null;
    this.playhead = 0;
    this.showSafe = true;
    this.drag = null;
    this.bindEvents();
    this.draw();
  };

  HH.CurveEditor.prototype.setChannel = function (ch) {
    this.channel = ch;
    this.selected = null;
    this.draw();
  };

  HH.CurveEditor.prototype.setPlayhead = function (t) {
    this.playhead = HH.clamp(t, 0, 1);
    this.draw();
  };

  HH.CurveEditor.prototype.setSafeVisible = function (v) {
    this.showSafe = v;
    this.draw();
  };

  HH.CurveEditor.prototype.range = function () {
    return HH.CHANNEL_RANGES[this.channel];
  };

  HH.CurveEditor.prototype.points = function () {
    return sorted(this.config[this.channel].points);
  };

  HH.CurveEditor.prototype.xOf = function (t) {
    const w = this.canvas.width - PAD_L - PAD_R;
    return PAD_L + t * w;
  };

  HH.CurveEditor.prototype.yOf = function (v) {
    const r = this.range();
    const h = this.canvas.height - PAD_T - PAD_B;
    const u = (v - r.min) / (r.max - r.min);
    return PAD_T + (1 - u) * h;
  };

  HH.CurveEditor.prototype.toData = function (ev) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (this.canvas.height / rect.height);
    const r = this.range();
    const w = this.canvas.width - PAD_L - PAD_R;
    const h = this.canvas.height - PAD_T - PAD_B;
    return {
      t: HH.clamp((x - PAD_L) / w, 0, 1),
      v: HH.clamp(r.max - ((y - PAD_T) / h) * (r.max - r.min), r.min, r.max),
      x,
      y,
    };
  };

  HH.CurveEditor.prototype.hitPoint = function (x, y) {
    const pts = this.points();
    for (let i = pts.length - 1; i >= 0; i--) {
      const px = this.xOf(pts[i].t);
      const py = this.yOf(pts[i].v);
      if (Math.hypot(px - x, py - y) <= HIT_R + 3) return pts[i];
    }
    return null;
  };

  HH.CurveEditor.prototype.bindEvents = function () {
    const self = this;
    this.canvas.addEventListener("pointerdown", function (ev) {
      const d = self.toData(ev);
      const hit = self.hitPoint(d.x, d.y);
      if (hit) {
        self.selected = hit;
        self.drag = hit;
        self.canvas.setPointerCapture(ev.pointerId);
      } else {
        const pts = self.points();
        const point = { t: d.t, v: d.v };
        pts.push(point);
        sorted(pts);
        self.selected = point;
        self.drag = point;
        self.canvas.setPointerCapture(ev.pointerId);
        self.onChange();
      }
      self.draw();
    });

    this.canvas.addEventListener("pointermove", function (ev) {
      if (!self.drag) return;
      const d = self.toData(ev);
      const pts = self.points();
      const idx = pts.indexOf(self.drag);
      self.drag.t = d.t;
      self.drag.v = d.v;
      sorted(pts);
      if (pts.indexOf(self.drag) !== idx) self.selected = self.drag;
      self.onChange();
      self.draw();
    });

    function endDrag(ev) {
      if (!self.drag) return;
      self.drag = null;
      try { self.canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
    }
    this.canvas.addEventListener("pointerup", endDrag);
    this.canvas.addEventListener("pointercancel", endDrag);
  };

  HH.CurveEditor.prototype.addPoint = function () {
    const pts = this.points();
    const t = 0.5;
    const v = HH.sampleCurve(pts, t);
    const point = { t, v };
    pts.push(point);
    sorted(pts);
    this.selected = point;
    this.onChange();
    this.draw();
  };

  HH.CurveEditor.prototype.deleteSelected = function () {
    const pts = this.points();
    if (!this.selected || pts.length <= 2) return;
    const idx = pts.indexOf(this.selected);
    if (idx >= 0) pts.splice(idx, 1);
    this.selected = null;
    this.onChange();
    this.draw();
  };

  HH.CurveEditor.prototype.resetChannel = function () {
    const fresh = HH.defaultConfig()[this.channel];
    this.config[this.channel].points = fresh.points.map((p) => ({ t: p.t, v: p.v }));
    this.selected = null;
    this.onChange();
    this.draw();
  };

  HH.CurveEditor.prototype.draw = function () {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const r = this.range();
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#242b35";
    ctx.fillRect(0, 0, cw, ch);

    ctx.strokeStyle = "#333c49";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#93a0b0";
    ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const y = PAD_T + ((ch - PAD_T - PAD_B) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(cw - PAD_R, y);
      ctx.stroke();
      const value = r.max - ((r.max - r.min) / 4) * i;
      ctx.fillText(Math.round(value * 10) / 10 + r.unit, 8, y + 4);
    }
    for (let i = 0; i <= 5; i++) {
      const x = PAD_L + ((cw - PAD_L - PAD_R) / 5) * i;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, ch - PAD_B);
      ctx.stroke();
      ctx.fillText((i / 5).toFixed(1), x - 8, ch - 12);
    }

    if (this.showSafe && this.channel !== "roll" && this.safeLimits) {
      const lim = this.safeLimits[this.channel];
      ctx.strokeStyle = "rgba(70,209,138,0.75)";
      ctx.setLineDash([8, 6]);
      [lim.min, lim.max].forEach((v) => {
        const y = this.yOf(HH.clamp(v, r.min, r.max));
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(cw - PAD_R, y);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(70,209,138,0.9)";
      ctx.fillText("安全区（未计旋转）", PAD_L + 6, PAD_T + 12);
    }

    const pts = this.points();
    ctx.strokeStyle = "#4ea1ff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = this.xOf(t);
      const y = this.yOf(HH.sampleCurve(pts, t));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    pts.forEach((p) => {
      const x = this.xOf(p.t);
      const y = this.yOf(p.v);
      ctx.beginPath();
      ctx.arc(x, y, HIT_R - 2, 0, Math.PI * 2);
      ctx.fillStyle = p === this.selected ? "#ffd27a" : "#7cc4ff";
      ctx.fill();
      ctx.strokeStyle = "#0d141d";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    const px = this.xOf(this.playhead);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, PAD_T);
    ctx.lineTo(px, ch - PAD_B);
    ctx.stroke();

    ctx.fillStyle = "#e6eaf0";
    ctx.font = "12px sans-serif";
    ctx.fillText(r.label + "（" + r.unit + "）", PAD_L, 12);
  };
})();
