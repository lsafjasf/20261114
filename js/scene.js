// 纯代码生成的动画场景：浏览器与 Node 共用同一套光栅化逻辑，不加载任何视频/图片。

export const WIDTH = 320;
export const HEIGHT = 200;
export const FRAME_COUNT = 48;
export const DURATION = 2.0; // 秒
export const FRAME_DURATION = DURATION / FRAME_COUNT;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// HSL -> [r, g, b]，h: [0,360)，s/l: [0,1]
export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(channel(hue + 1 / 3) * 255),
    Math.round(channel(hue) * 255),
    Math.round(channel(hue - 1 / 3) * 255),
  ];
}

// 逐像素软件光栅化器，输出 RGBA（alpha 恒为 255）
export class Rasterizer {
  constructor(width = WIDTH, height = HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  clear(rgb) {
    const [r, g, b] = rgb;
    for (let i = 0; i < this.width * this.height; i++) {
      const o = i * 4;
      this.pixels[o] = r;
      this.pixels[o + 1] = g;
      this.pixels[o + 2] = b;
      this.pixels[o + 3] = 255;
    }
  }

  // coverage: [0,1] 的覆盖率，用于边缘抗锯齿
  blendPixel(x, y, rgb, coverage = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 4;
    const keep = 1 - coverage;
    this.pixels[o] = this.pixels[o] * keep + rgb[0] * coverage;
    this.pixels[o + 1] = this.pixels[o + 1] * keep + rgb[1] * coverage;
    this.pixels[o + 2] = this.pixels[o + 2] * keep + rgb[2] * coverage;
  }

  fillRect(x0, y0, x1, y1, rgb) {
    const xa = Math.max(0, Math.ceil(x0));
    const ya = Math.max(0, Math.ceil(y0));
    const xb = Math.min(this.width - 1, Math.floor(x1));
    const yb = Math.min(this.height - 1, Math.floor(y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) this.blendPixel(x, y, rgb, 1);
    }
  }

  // 带 1px 抗锯齿的实心圆
  fillCircle(cx, cy, radius, rgb) {
    const xa = Math.max(0, Math.floor(cx - radius - 1));
    const xb = Math.min(this.width - 1, Math.ceil(cx + radius + 1));
    const ya = Math.max(0, Math.floor(cy - radius - 1));
    const yb = Math.min(this.height - 1, Math.ceil(cy + radius + 1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const coverage = clamp(radius - dist + 0.5, 0, 1);
        if (coverage > 0) this.blendPixel(x, y, rgb, coverage);
      }
    }
  }

  // 绕中心旋转的实心矩形（size 为边长）
  fillRotatedSquare(cx, cy, size, angle, rgb) {
    const half = size / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reach = Math.ceil(half * (Math.abs(cos) + Math.abs(sin)));
    for (let y = cy - reach; y <= cy + reach; y++) {
      for (let x = cx - reach; x <= cx + reach; x++) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const localX = dx * cos + dy * sin;
        const localY = -dx * sin + dy * cos;
        const coverage = clamp(
          Math.min(half - Math.abs(localX), half - Math.abs(localY)) + 0.5,
          0,
          1,
        );
        if (coverage > 0) this.blendPixel(x, y, rgb, coverage);
      }
    }
  }
}

// 场景参数：A、B 两段动画由同一 renderScene 生成，只在此处取值不同。
export const DEFAULT_PARAMS = {
  sunHue: 45, // 太阳色相（度）——验证时调整的颜色参数
  bgTopLightness: 0.82,
  bgBottomLightness: 0.45,
  squareHue: 210,
  squareLightness: 0.45,
  cloudLightness: 0.97,
  groundLightness: 0.32,
};

// frame 为关键帧序号 [0, FRAME_COUNT)，返回 RGBA Uint8ClampedArray
export function renderScene(frame, params = DEFAULT_PARAMS) {
  const t = frame / (FRAME_COUNT - 1); // 归一化时间 [0,1]
  const r = new Rasterizer();

  // 天空：水平方向恒定、垂直方向线性渐变
  for (let y = 0; y < HEIGHT; y++) {
    const k = y / (HEIGHT - 1);
    const lightness =
      params.bgTopLightness +
      (params.bgBottomLightness - params.bgTopLightness) * k;
    r.fillRect(0, y, WIDTH - 1, y, hslToRgb(205, 0.55, lightness));
  }

  // 太阳：沿弧线运动，色相由 sunHue 参数控制（A/B 的差异源）
  const sunX = 48 + (WIDTH - 96) * t;
  const sunY = 150 - 90 * Math.sin(Math.PI * t);
  r.fillCircle(sunX, sunY, 20, hslToRgb(params.sunHue, 0.9, 0.55));

  // 地面
  r.fillRect(
    0,
    HEIGHT - 36,
    WIDTH - 1,
    HEIGHT - 1,
    hslToRgb(120, 0.4, params.groundLightness),
  );

  // 云：匀速横向漂移，循环入场
  const cloudY = 42;
  const cloudBase = ((t * 1.4) % 1) * (WIDTH + 90) - 45;
  const cloudColor = hslToRgb(0, 0, params.cloudLightness);
  for (const [ox, oy, rad] of [
    [0, 0, 14],
    [16, -6, 11],
    [32, 0, 12],
  ]) {
    r.fillCircle(cloudBase + ox, cloudY + oy, rad, cloudColor);
  }

  // 旋转方块：中心固定、角度随时间变化
  const angle = t * Math.PI * 2;
  r.fillRotatedSquare(
    WIDTH / 2,
    HEIGHT - 70,
    44,
    angle,
    hslToRgb(params.squareHue, 0.65, params.squareLightness),
  );

  return r.pixels;
}
