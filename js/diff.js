import { clamp, WIDTH, HEIGHT } from './scene.js';

// 按 RGB 欧氏距离（0~441.67）逐像素比较两段动画的同一关键帧。
// 返回差异距离数组与统计指标：变化像素比例、最大差异位置。
export function computeDiff(bufA, bufB, threshold = 25) {
  const count = WIDTH * HEIGHT;
  const distances = new Float32Array(count);
  let changed = 0;
  let maxDistance = -1;
  let maxIndex = 0;
  let sumDistance = 0;

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const dr = bufA[o] - bufB[o];
    const dg = bufA[o + 1] - bufB[o + 1];
    const db = bufA[o + 2] - bufB[o + 2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    distances[i] = dist;
    sumDistance += dist;
    if (dist >= threshold) changed++;
    if (dist > maxDistance) {
      maxDistance = dist;
      maxIndex = i;
    }
  }

  return {
    distances,
    changedRatio: changed / count,
    maxDistance,
    maxX: maxIndex % WIDTH,
    maxY: Math.floor(maxIndex / WIDTH),
    meanDistance: sumDistance / count,
  };
}

// 热力图色带：无差异 -> 黑 -> 蓝 -> 红 -> 黄 -> 白
function heatColor(normalized) {
  const v = clamp(normalized, 0, 1);
  const stops = [
    [0.0, [0, 0, 0]],
    [0.08, [40, 60, 220]],
    [0.3, [220, 40, 40]],
    [0.8, [240, 220, 40]],
    [1.0, [255, 255, 255]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const k = (v - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// 把指定模式渲染到目标 ImageData。
// mode: 'original' | 'diff' | 'overlay'
export function renderView(imageData, bufA, bufB, diff, mode, threshold) {
  const out = imageData.data;
  const { distances } = diff;
  const count = WIDTH * HEIGHT;
  const scale = 1 / 255; // 以单通道满量程归一，突出实际颜色差异

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    let r;
    let g;
    let b;
    const dist = distances[i];

    if (mode === 'original') {
      r = bufA[o];
      g = bufA[o + 1];
      b = bufA[o + 2];
    } else if (mode === 'diff') {
      [r, g, b] = heatColor(dist * scale);
    } else {
      // 叠加：以 A 为底，差异区按强度混入红色，便于定位变化区域
      const strength = clamp((dist - threshold) / 120 + 0.25, 0, 1);
      r = bufA[o] * (1 - strength) + 255 * strength;
      g = bufA[o + 1] * (1 - strength);
      b = bufA[o + 2] * (1 - strength);
    }

    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = 255;
  }
}

// 在画布上绘制最大差异位置的十字标记
export function drawMaxMarker(ctx, x, y, color = '#00ffcc') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 0.5);
  ctx.lineTo(x + 7, y + 0.5);
  ctx.moveTo(x + 0.5, y - 7);
  ctx.lineTo(x + 0.5, y + 7);
  ctx.stroke();
  ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
  ctx.restore();
}
