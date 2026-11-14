// Canvas 2D 极光引擎：逐帧计算带状遮罩与色彩叠加，不使用贴图位移。
// 同一份代码同时运行于浏览器（原生 Canvas）与 Node（@napi-rs/canvas）。

import { mulberry32, ValueNoise2D, hashSeed } from './prng.js';
import { auroraPalette, bandStops, rgba, clamp01, clamp255 } from './color.js';

export const DEFAULTS = Object.freeze({
  seed: 20261114,
  time: 0,
  playing: true,
  sourceX: 0.32, // 光源水平位置（0-1）
  sourceY: 0.62, // 光源垂直位置（0-1，越大越靠近地平线）
  brightness: 0.75, // 整体亮度（0-1）
  density: 0.55, // 极光密度（0-1）：影响褶皱、光丝数量与厚度
  cool: 0.45, // 冷色调（0-1）：绿 -> 蓝紫
});

// 内部低分辨率缓冲，再上采样到显示画布，保证分层渐变的柔边。
export const BUFFER_WIDTH = 320;
export const BUFFER_HEIGHT = 180;

export class AuroraEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.params = { ...DEFAULTS, ...options };
    this._last = performance.now();
    this._buildSeedData();
  }

  reset(options = {}) {
    this.params = { ...DEFAULTS, ...options };
    this._buildSeedData();
  }

 setParam(key, value) {
    if (!(key in this.params)) return;
    this.params[key] = value;
    if (key === 'seed') this._buildSeedData();
  }

  setParams(values) {
    for (const [k, v] of Object.entries(values)) this.setParam(k, v);
  }

  // 所有随机元素（星空、光丝相位、噪声场）都由 seed 决定，保证同 seed 可复现。
  _buildSeedData() {
    const seed = hashSeed(this.params.seed);
    this.noise = new ValueNoise2D(seed);
    this.fineNoise = new ValueNoise2D(seed ^ 0x9e3779b9);
    const rand = mulberry32(seed ^ 0x51f15e);
    this.stars = [];
    const starCount = 210;
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: rand(),
        y: rand() * 0.82,
        r: 0.35 + rand() * 1.1,
        base: 0.25 + rand() * 0.65,
        phase: rand() * Math.PI * 2,
        speed: 0.4 + rand() * 1.6,
        cool: rand(),
      });
    }
  }

  // 供 rAF 调用；Node 离线渲染时直接用 renderAt(t)。
  tick(now = performance.now()) {
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    if (this.params.playing) this.params.time += dt;
    return this.renderAt(this.params.time);
  }

  // 确定性渲染：相同 seed + time + 参数 => 像素级一致。
  renderAt(time) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const p = this.params;
    const palette = auroraPalette(p.cool);
    const brightness = 0.35 + p.brightness * 0.95;

    this._drawSky(ctx, W, H, p);
    this._drawStars(ctx, W, H, time, palette);
    this._drawAurora(ctx, W, H, time, palette, brightness, p, 'lighter');
    this._drawAurora(ctx, W, H, time, palette, brightness, p, 'screen');
    this._drawRays(ctx, W, H, time, palette, brightness, p);
    this._drawFog(ctx, W, H, p, palette, brightness);
    this._drawVignette(ctx, W, H);
    return canvas;
  }

  _drawSky(ctx, W, H, p) {
    const top = mix3([4, 7, 18], [8, 12, 30], p.cool);
    const mid = mix3([10, 18, 38], [14, 22, 52], p.cool);
    const horizon = mix3([20, 34, 52], [26, 34, 66], p.cool);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top));
    g.addColorStop(0.55, rgb(mid));
    g.addColorStop(1, rgb(horizon));
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawStars(ctx, W, H, time, palette) {
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
      const alpha = s.base * twinkle * 0.9;
      const x = s.x * W;
      const y = s.y * H;
      const tint = s.cool > 0.5 ? palette.ray : [235, 240, 255];
      ctx.fillStyle = rgba(tint, alpha);
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 极光带：沿 x 采样 fBm 得到平滑扭动的上下边缘，用闭合路径填充形成带状遮罩。
  _bandField(x01, time, p, layer) {
    const drift = time * (0.03 + layer * 0.012);
    const nx = x01 * (1.8 + layer * 0.7) + drift + layer * 11.3;
    const sway = this.noise.fbm(nx, 6.28 + layer * 4.1, 4);
    const fold = this.noise.fbm(x01 * 3.4 + drift * 0.5, 1.7 + layer * 2.3, 3);
    const thicknessNoise = this.fineNoise.fbm(x01 * 3.6 - drift * 0.7, 2.71 + layer, 3);
    const baseY = 0.42 + layer * 0.16 - p.sourceY * 0.14;
    const centerY = baseY + sway * (0.12 + layer * 0.03);
    const halfHeight =
      (0.1 + p.density * 0.16 + layer * 0.05) * (0.8 + 0.45 * thicknessNoise);
    return { centerY, halfHeight, fold, thicknessNoise };
  }

  _sampleBand(W, H, time, p, layer, samples) {
    const top = new Float32Array(samples);
    const bottom = new Float32Array(samples);
    const fold = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x01 = i / (samples - 1);
      const f = this._bandField(x01, time, p, layer);
      top[i] = (f.centerY - f.halfHeight) * H;
      bottom[i] = (f.centerY + f.halfHeight * 0.85) * H;
      fold[i] = f.fold;
    }
    return { top, bottom, fold };
  }

  _tracePath(ctx, W, samples, edgeA, edgeB) {
    ctx.beginPath();
    ctx.moveTo(0, edgeA[0]);
    for (let i = 1; i < samples; i++) ctx.lineTo((i / (samples - 1)) * W, edgeA[i]);
    for (let i = samples - 1; i >= 0; i--) ctx.lineTo((i / (samples - 1)) * W, edgeB[i]);
    ctx.closePath();
  }

  _drawAurora(ctx, W, H, time, palette, brightness, p, mode) {
    const passAlpha = mode === 'lighter' ? 0.5 : 0.32;
    const intensity = brightness * passAlpha;
    const stops = bandStops(palette, intensity);
    const samples = 96;
    ctx.globalCompositeOperation = mode;

    for (let layer = 0; layer < 2; layer++) {
      const band = this._sampleBand(W, H, time, p, layer, samples);
      const layerGain = layer === 0 ? 1 : 0.62;

      // 整体垂直渐变填充平滑带状遮罩。
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < samples; i++) {
        minY = Math.min(minY, band.top[i]);
        maxY = Math.max(maxY, band.bottom[i]);
      }
      const g = ctx.createLinearGradient(0, minY, 0, maxY);
      for (const st of stops) g.addColorStop(st.pos, rgba(st.rgb, st.alpha * layerGain));
      this._tracePath(ctx, W, samples, band.top, band.bottom);
      ctx.fillStyle = g;
      ctx.fill();

      // 褶皱：沿带中心的细亮线，强度由独立噪声门控，制造折叠光感。
      ctx.lineCap = 'round';
      for (let i = 1; i < samples - 1; i++) {
        const foldGain = clamp01((band.fold[i] + 0.4) * 1.4);
        if (foldGain < 0.25) continue;
        const x = (i / (samples - 1)) * W;
        const y = (band.top[i] + band.bottom[i]) * 0.5;
        const a = 0.1 * intensity * layerGain * foldGain;
        ctx.strokeStyle = rgba(palette.core, a);
        ctx.lineWidth = (1 + p.density * 2.2) * (W / BUFFER_WIDTH);
        ctx.beginPath();
        ctx.moveTo(x - W / samples, (band.top[i - 1] + band.bottom[i - 1]) * 0.5);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 光丝：密度越高数量越多，向光源方向倾斜，强度由噪声门控。
  _drawRays(ctx, W, H, time, palette, brightness, p) {
    const rayCount = Math.round(14 + p.density * 52);
    const rand = mulberry32(hashSeed(this.params.seed) ^ 0x77a1);
    for (let i = 0; i < rayCount; i++) {
      const x01 = rand();
      const phase = rand() * Math.PI * 2;
      const wander = this.fineNoise.fbm(x01 * 4, time * 0.05 + 9.1, 3);
      const shimmer = 0.5 + 0.5 * Math.sin(time * (0.6 + rand() * 0.8) + phase);
      const field = this._bandField(x01, time, p, 0);
      const baseX = (x01 + wander * 0.012) * W;
      const baseY = (field.centerY + field.halfHeight * 0.55) * H;
      // 向光源收敛的倾斜方向
      const sx = p.sourceX * W;
      const sy = p.sourceY * H;
      const dirX = (sx - baseX) / W;
      const dirY = (sy - baseY) / H;
      const len = H * (0.18 + p.density * 0.22) * (0.6 + 0.6 * shimmer);
      const topX = baseX + dirX * len * 0.5;
      const topY = baseY + dirY * len - len;
      const width = (1.2 + p.density * 3.4) * (W / BUFFER_WIDTH) * (0.5 + shimmer);

      const a = (0.04 + shimmer * 0.12) * brightness * (0.35 + p.density * 0.7);
      // 多段折线 + 噪声扰动，形成弯曲上升的极光帘，而非死板直线。
      const segments = 5;
      const pts = [];
      for (let s = 0; s <= segments; s++) {
        const t = s / segments;
        const bend = this.fineNoise.fbm(x01 * 6 + t * 1.3, time * 0.08 + phase, 3) * width * 2.4;
        pts.push({
          x: baseX + (topX - baseX) * t + bend * (0.3 + t),
          y: baseY + (topY - baseY) * t,
        });
      }
      const g = ctx.createLinearGradient(baseX, baseY, topX, topY);
      g.addColorStop(0, rgba(palette.ray, 0));
      g.addColorStop(0.3, rgba(palette.ray, a));
      g.addColorStop(1, rgba(palette.core, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let s = 1; s <= segments; s++) ctx.lineTo(pts[s].x, pts[s].y);
      ctx.stroke();
    }
  }

  // 雾化边缘：地平线冷雾 + 以光源为中心的径向辉光，用 source-over 柔化混合。
  _drawFog(ctx, W, H, p, palette, brightness) {
    ctx.globalCompositeOperation = 'source-over';
    const fogH = H * (0.34 + (1 - p.density) * 0.12);
    const fogColor = mix3(palette.edge, [12, 18, 34], 0.55);
    const g = ctx.createLinearGradient(0, H - fogH, 0, H);
    g.addColorStop(0, rgba(fogColor, 0));
    g.addColorStop(1, rgba(fogColor, 0.62));
    ctx.fillStyle = g;
    ctx.fillRect(0, H - fogH, W, fogH);

    const sx = p.sourceX * W;
    const sy = p.sourceY * H;
    const radius = W * (0.55 + p.brightness * 0.35);
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    rg.addColorStop(0, rgba(palette.mid, 0.16 * brightness));
    rg.addColorStop(0.5, rgba(palette.edge, 0.06 * brightness));
    rg.addColorStop(1, rgba(palette.edge, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }

  _drawVignette(ctx, W, H) {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.5, W * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgb(c) {
  return `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})`;
}
