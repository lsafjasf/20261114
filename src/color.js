// 极光色彩：冷色调参数在暖绿与冷蓝紫之间插值，全部用透明叠加。

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

const mix = (a, b, t) => a + (b - a) * t;

function mixRgb(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// cool=0 偏青绿（经典极光），cool=1 偏蓝紫（高冷夜空）
export function auroraPalette(cool) {
  const c = clamp01(cool);
  return {
    core: mixRgb([150, 255, 190], [150, 200, 255], c),
    mid: mixRgb([60, 235, 140], [90, 130, 255], c),
    edge: mixRgb([30, 150, 110], [80, 70, 200], c),
    ray: mixRgb([120, 255, 200], [140, 190, 255], c),
  };
}

export function rgba(rgb, alpha) {
  return `rgba(${clamp255(rgb[0])},${clamp255(rgb[1])},${clamp255(rgb[2])},${clamp01(alpha).toFixed(4)})`;
}

// 光幕随高度的颜色权重：核心亮、边缘雾化。
export function bandStops(palette, intensity) {
  return [
    { pos: 0.0, rgb: palette.edge, alpha: 0.0 },
    { pos: 0.18, rgb: palette.edge, alpha: 0.22 * intensity },
    { pos: 0.5, rgb: palette.mid, alpha: 0.6 * intensity },
    { pos: 0.72, rgb: palette.core, alpha: 0.95 * intensity },
    { pos: 0.86, rgb: palette.core, alpha: 0.5 * intensity },
    { pos: 1.0, rgb: palette.edge, alpha: 0.0 },
  ];
}
