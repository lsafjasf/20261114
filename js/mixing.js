/*
 * 减色混合引擎（浏览器 / Node 通用）
 * 模型：四种颜料按比例混合，Beer-Lambert 吸光定律叠加油膜厚度，
 *       白色承印物透出；颜料总量越低，颜色越淡（饱和度、明度同时变化）。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Mixing = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;
  const D_PER_100 = 0.55; // 每 100 单位颜料对应的油膜厚度

  // 颜料在线性 RGB 空间的基础反射率（工艺色近似值）
  const PIGMENTS = [
    { id: 'cyan',    name: '青色 C',   base: [0.00, 0.42, 0.80] },
    { id: 'magenta', name: '品红色 M', base: [0.78, 0.03, 0.32] },
    { id: 'yellow',  name: '黄色 Y',   base: [1.00, 0.80, 0.02] },
    { id: 'black',   name: '黑色 K',   base: [0.03, 0.03, 0.03] }
  ];

  // 各颜料每通道吸光度 A = -ln(R)
  const ABSORB = PIGMENTS.map(function (p) {
    return p.base.map(function (r) {
      return -Math.log(Math.max(r, 0.005));
    });
  });

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function srgbToLinear(c) {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  }

  function linearToSrgbChannel(c) {
    const v = c <= 0.0031308
      ? c * 12.92
      : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(clamp01(v) * 255);
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) {
      const h = v.toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('').toUpperCase();
  }

  function linearToXYZ(lin) {
    return [
      lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375,
      lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.0721750,
      lin[0] * 0.0193339 + lin[1] * 0.1191920 + lin[2] * 0.9503041
    ];
  }

  const XN = 0.95047, YN = 1.0, ZN = 1.08883;
  const DELTA = 6 / 29;

  function labF(t) {
    return t > DELTA * DELTA ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29;
  }

  function linearToLab(lin) {
    const xyz = linearToXYZ(lin);
    const fx = labF(xyz[0] / XN);
    const fy = labF(xyz[1] / YN);
    const fz = labF(xyz[2] / ZN);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max > min + EPS) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }

  /*
   * 核心混合：amounts = [C, M, Y, K]，每项 0..100
   * 返回线性反射率、sRGB、HEX、Lab、HSL 与总量
   */
  function mix(amounts) {
    const total = amounts.reduce(function (a, b) { return a + b; }, 0);
    if (total <= EPS) {
      const white = [1, 1, 1];
      const rgb = [255, 255, 255];
      return {
        amounts: amounts.slice(), total: 0, linear: white,
        rgb: rgb, hex: '#FFFFFF', lab: linearToLab(white),
        hsl: rgbToHsl(255, 255, 255)
      };
    }

    const depth = (total / 100) * D_PER_100;
    const absorb = [0, 0, 0];
    for (let p = 0; p < 4; p++) {
      const w = amounts[p] / total;
      for (let ch = 0; ch < 3; ch++) {
        absorb[ch] += w * ABSORB[p][ch];
      }
    }

    const linear = absorb.map(function (a) {
      return Math.exp(-a * depth); // 白色底物反射率为 1
    });
    const rgb = linear.map(linearToSrgbChannel);
    return {
      amounts: amounts.slice(), total: total, linear: linear,
      rgb: rgb, hex: rgbToHex(rgb), lab: linearToLab(linear),
      hsl: rgbToHsl(rgb[0], rgb[1], rgb[2])
    };
  }

  // CIE76 色差
  function deltaE(labA, labB) {
    const dl = labA[0] - labB[0];
    const da = labA[1] - labB[1];
    const db = labA[2] - labB[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 生成一个可由颜料复现的随机目标配比
  function randomTarget(rng) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const q = PIGMENTS.map(function () {
        if (rng() < 0.25) return 0;
        return Math.round(15 + rng() * 85);
      });
      const nonzero = q.filter(function (v) { return v > 0; }).length;
      const total = q.reduce(function (a, b) { return a + b; }, 0);
      if (nonzero >= 2 && total >= 60) return q;
    }
    return [40, 40, 40, 10];
  }

  return {
    PIGMENTS: PIGMENTS,
    TOLERANCE: 2.5,
    MAX_AMOUNT: 100,
    mix: mix,
    deltaE: deltaE,
    linearToLab: linearToLab,
    srgbToLinear: srgbToLinear,
    rgbToHsl: rgbToHsl,
    rgbToHex: rgbToHex,
    mulberry32: mulberry32,
    randomTarget: randomTarget
  };
});
