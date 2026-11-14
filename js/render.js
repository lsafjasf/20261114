/* Canvas 渲染：频谱瀑布、方位罗盘、信号电平表 */
(function (global) {
  "use strict";
  var NF = global.NF;
  var C = NF.CONST;

  function Renderer() {
    this.wf = document.getElementById("waterfall");
    this.wctx = this.wf.getContext("2d");
    this.compass = document.getElementById("compass");
    this.cctx = this.compass.getContext("2d");
    this.meterFill = document.getElementById("meter-fill");
    this.meterDb = document.getElementById("meter-db");
    this.cols = 160;
    this._off = document.createElement("canvas");
    this._ocol = this._off.getContext("2d");
    this._resize();
    this._paintIdle();
  }

  Renderer.prototype._resize = function () {
    var w = this.wf.clientWidth || 760;
    var h = 260;
    [this.wf, this._off].forEach(function (cv) {
      cv.width = w;
      cv.height = h;
    });
    this.w = w;
    this.h = h;
    this.colW = w / this.cols;
  };

  Renderer.prototype._paintIdle = function () {
    var g = this.wctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, "#071018");
    g.addColorStop(1, "#03060a");
    this.wctx.fillStyle = g;
    this.wctx.fillRect(0, 0, this.w, this.h);
  };

  // 计算一列像素的能量（窗口 ±4kHz，含底噪与滤波后信号）
  Renderer.prototype._column = function (st) {
    var data = new Float32Array(this.h);
    var half = C.WINDOW_HALF;
    var noise = NF.noiseBase(st.simTime);
    for (var y = 0; y < this.h; y++) {
      var frac = y / (this.h - 1);          // 顶部为高频
      var fAbs = st.tuned + half - 2 * half * frac;
      var v = noise * NF.filterFactor(fAbs - st.tuned, st.bw)
        * (0.7 + Math.random() * 0.6);
      data[y] = v;
    }
    NF.getSignals(st).forEach(function (s) {
      if (!s.on || Math.abs(s.offset) > half) { return; }
      var yy = (half - s.offset) / (2 * half) * (this.h - 1);
      var spread = Math.max(2, this.h * st.bw * 0.012);
      var peak = s.base * 0.55 + s.level;
      for (var k = -6; k <= 6; k++) {
        var idx = Math.round(yy + k * spread * 0.35);
        if (idx < 0 || idx >= this.h) { continue; }
        var fall = Math.exp(-(k * k) / 8);
        data[idx] += peak * fall * (0.85 + Math.random() * 0.3);
      }
    }, this);
    return data;
  };

  Renderer.prototype._color = function (v) {
    if (v < 0.12) {
      var b = Math.round(14 + v * 120);
      return "rgb(4," + Math.round(b * 0.55) + "," + b + ")";
    }
    if (v < 0.45) {
      var t = (v - 0.12) / 0.33;
      return "rgb(" + Math.round(20 + 90 * t) + ","
        + Math.round(70 + 150 * t) + ",90)";
    }
    if (v < 0.75) {
      var t2 = (v - 0.45) / 0.3;
      return "rgb(" + Math.round(180 + 60 * t2) + ","
        + Math.round(180 - 90 * t2) + ",40)";
    }
    return "rgb(240," + Math.round(120 - 60 * (v - 0.75) / 0.25) + ",80)";
  };

  Renderer.prototype.drawWaterfall = function (st) {
    var o = this._ocol;
    o.drawImage(this.wf, -this.colW, 0);
    var x = this.w - this.colW;
    var col = this._column(st);
    for (var y = 0; y < this.h; y++) {
      o.fillStyle = this._color(Math.min(1, col[y]));
      o.fillRect(x, y, this.colW + 1, 1);
    }
    this.wctx.drawImage(this._off, 0, 0);
    this._drawOverlays(st);
  };

  Renderer.prototype._drawOverlays = function (st) {
    var ctx = this.wctx;
    // 滤波通带框
    var half = C.WINDOW_HALF;
    var y1 = (half - st.bw / 2) / (2 * half) * this.h;
    var y2 = (half + st.bw / 2) / (2 * half) * this.h;
    ctx.strokeStyle = "rgba(92,200,232,.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(1, y1, this.w - 2, y2 - y1);
    ctx.setLineDash([]);
    // 中心调谐线
    ctx.strokeStyle = "rgba(70,224,138,.8)";
    ctx.beginPath();
    ctx.moveTo(0, this.h / 2);
    ctx.lineTo(this.w, this.h / 2);
    ctx.stroke();
    // 频标
    ctx.font = "11px Consolas, monospace";
    ctx.textBaseline = "middle";
    NF.getSignals(st).forEach(function (s) {
      if (!s.on || Math.abs(s.offset) > half) { return; }
      var yy = (half - s.offset) / (2 * half) * this.h;
      var color = s.type === "decoy" ? "#ef5d5d"
        : (s.type === "interferer" ? "#b58bd6"
          : (st.locks[s.id] ? "#46e08a" : "#f0b54a"));
      ctx.fillStyle = color;
      ctx.fillRect(this.w - 6, yy - 1, 5, 2);
      ctx.fillText(s.id, this.w - 34, yy - 8);
    }, this);
    // 频率刻度
    ctx.fillStyle = "#5f7a8c";
    ctx.fillText("+" + half.toFixed(1) + "k", 6, 10);
    ctx.fillText(NF.formatMHz(st.tuned), 6, this.h / 2 - 8);
    ctx.fillText("−" + half.toFixed(1) + "k", 6, this.h - 10);
  };

  Renderer.prototype.drawCompass = function (st) {
    var ctx = this.cctx;
    var w = this.compass.width, r = w / 2;
    ctx.clearRect(0, 0, w, w);
    ctx.save();
    ctx.translate(r, r);
    // 底盘
    ctx.beginPath();
    ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0a1219";
    ctx.fill();
    ctx.strokeStyle = "#243544";
    ctx.stroke();
    // 刻度（随航向旋转）
    for (var deg = 0; deg < 360; deg += 10) {
      var a = (deg - st.heading - 90) * Math.PI / 180;
      var r1 = r - (deg % 30 === 0 ? 18 : 10);
      ctx.strokeStyle = deg % 30 === 0 ? "#6f8494" : "#33475a";
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
      ctx.stroke();
    }
    ["N", "E", "S", "W"].forEach(function (ch, i) {
      var aa = (i * 90 - st.heading - 90) * Math.PI / 180;
      ctx.fillStyle = ch === "N" ? "#46e08a" : "#6f8494";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ch, Math.cos(aa) * (r - 34), Math.sin(aa) * (r - 34));
    });
    // 信号方位点
    NF.getSignals(st).forEach(function (s) {
      if (!s.on || s.level < 0.02) { return; }
      var rr = r - 56;
      var aa = (s.bearing - st.heading - 90) * Math.PI / 180;
      var color = s.type === "decoy" ? "#ef5d5d"
        : (s.type === "interferer" ? "#b58bd6"
          : (st.locks[s.id] ? "#46e08a" : "#f0b54a"));
      var rad = 3 + Math.min(6, s.level * 7);
      ctx.beginPath();
      ctx.arc(Math.cos(aa) * rr, Math.sin(aa) * rr, rad, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55 + Math.min(0.45, s.level);
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    // 航向箭头（固定指向顶部）
    ctx.beginPath();
    ctx.moveTo(0, -r + 16);
    ctx.lineTo(-7, -r + 32);
    ctx.lineTo(0, -r + 26);
    ctx.lineTo(7, -r + 32);
    ctx.closePath();
    ctx.fillStyle = "#5cc8e8";
    ctx.fill();
    ctx.fillStyle = "#c8d6e0";
    ctx.font = "bold 20px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(Math.round(st.heading) + "°", 0, 4);
    ctx.restore();
  };

  Renderer.prototype.drawMeter = function (level) {
    var pct = Math.round(level * 100);
    this.meterFill.style.width = pct + "%";
    var db = level > 0.004
      ? (20 * Math.log(level) / Math.LN10).toFixed(1) + " dB"
      : "−∞ dB";
    this.meterDb.textContent = db;
  };

  NF.Renderer = Renderer;
})(typeof window !== "undefined" ? window : globalThis);
