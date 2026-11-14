/* Canvas 视图：色轮、调色盘、目标/当前色块 */
(function (root, factory) {
  const mod = factory(typeof Mixing !== 'undefined' ? Mixing : require('./mixing.js'));
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Views = mod;
})(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';

  function setup(canvas) {
    const dpr = globalThis.devicePixelRatio || 1;
    const size = canvas.clientWidth || 240;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, size: size };
  }

  function hslCss(h, s, l, a) {
    return 'hsla(' + h + ',' + s + '%,' + l + '%,' + (a == null ? 1 : a) + ')';
  }

  // ---- 色轮：外圈色相环，内部当前色标记 ----
  function drawWheel(canvas, current) {
    const v = setup(canvas), ctx = v.ctx, size = v.size;
    const cx = size / 2, cy = size / 2;
    const outer = size / 2 - 4, inner = outer - 26;
    ctx.clearRect(0, 0, size, size);
    for (let deg = 0; deg < 360; deg++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outer, (deg - 1) * Math.PI / 180, (deg + 1.2) * Math.PI / 180);
      ctx.closePath();
      ctx.fillStyle = hslCss(deg, 85, 55);
      ctx.fill();
    }
    // 内圈挖空（纸张色）
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#f7f4ee';
    ctx.fill();

    // 中心当前色
    const r = inner - 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = current.hex;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // 色相聚拢标记
    const hue = current.hsl[0];
    const ang = hue * Math.PI / 180;
    const mr = (outer + inner) / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * mr, cy + Math.sin(ang) * mr, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#222';
    ctx.stroke();
  }

  // ---- 调色盘：四色颜料滴 + 中央混合区 ----
  function drawPalette(canvas, result) {
    const v = setup(canvas), ctx = v.ctx, size = v.size;
    const cx = size / 2, cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // 盘体
    ctx.beginPath();
    ctx.ellipse(cx, cy, size / 2 - 6, size / 2 - 14, 0, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, size / 2);
    bg.addColorStop(0, '#fbf9f4');
    bg.addColorStop(1, '#e6e0d4');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c9c1b2';
    ctx.stroke();

    // 四个颜料滴（半径随用量变化）
    const angles = [-90, 0, 90, 180];
    const orbit = size * 0.32;
    for (let i = 0; i < 4; i++) {
      const ang = angles[i] * Math.PI / 180;
      const x = cx + Math.cos(ang) * orbit;
      const y = cy + Math.sin(ang) * orbit;
      const amount = result.amounts[i];
      const r = 6 + amount * 0.16;
      const color = M.mix([
        i === 0 ? 100 : 0, i === 1 ? 100 : 0,
        i === 2 ? 100 : 0, i === 3 ? 100 : 0
      ]).hex;
      if (amount > 0) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.55 + 0.45 * (amount / 100);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 中央混合色
    const mr = 22 + Math.min(result.total, 200) * 0.08;
    ctx.beginPath();
    ctx.arc(cx, cy, mr, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - 6, cy - 6, 4, cx, cy, mr);
    g.addColorStop(0, lighten(result.hex, 0.25));
    g.addColorStop(1, result.hex);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.stroke();
  }

  function lighten(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const out = ch.map(function (c) {
      return Math.round(c + (255 - c) * f);
    });
    return M.rgbToHex(out);
  }

  // ---- 目标 / 当前色块 ----
  function drawSwatches(canvas, target, current, de, tolerance) {
    const dpr = globalThis.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 130;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const bw = w / 2 - 46, bh = h - 30, y = 6;
    block(ctx, 24, y, bw, bh, target.hex, '目标色', target.hex, null);
    const hit = de <= tolerance;
    block(ctx, w / 2 + 22, y, bw, bh, current.hex, '当前色',
      current.hex, hit ? 'rgba(46,160,67,0.9)' : null);

    // 中间色差
    ctx.fillStyle = '#333';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ΔE ' + de.toFixed(1), w / 2, h / 2 - 2);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = hit ? '#2ea043' : '#8a6d1a';
    ctx.fillText(hit ? '命中容差' : '容差 ' + tolerance, w / 2, h / 2 + 15);
  }

  function block(ctx, x, y, w, h, hex, label, code, ring) {
    ctx.fillStyle = hex;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    if (ring) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = ring;
      roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 12);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 8, y + 16);
    ctx.textAlign = 'right';
    ctx.fillText(code, x + w - 8, y + 16);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { drawWheel: drawWheel, drawPalette: drawPalette, drawSwatches: drawSwatches };
});
