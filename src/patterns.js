/*
 * 纺织纹样渲染内核（无 DOM 依赖，浏览器与 Node 共用）。
 * 所有纹样都定义在无限平面上，再通过取模/三角波折叠进单个循环单元，
 * 因此循环单元在数学上保证周期连续，接缝不会产生边框或断裂。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WeavePatterns = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PATTERN_TYPES = ['plain', 'twill', 'satin'];

  const DEFAULTS = {
    type: 'plain',
    tileW: 120,
    tileH: 120,
    lineWidth: 7,
    pitchX: 16,
    pitchY: 16,
    warpColor: '#b04a3a',
    weftColor: '#35618e',
    bgColor: '#f4eddc',
    mirrorX: false,
    mirrorY: false,
    ssaa: 2
  };

  const PRESETS = {
    plain: {
      type: 'plain', tileW: 128, tileH: 128, lineWidth: 7,
      pitchX: 16, pitchY: 16,
      warpColor: '#b04a3a', weftColor: '#35618e', bgColor: '#f4eddc',
      mirrorX: false, mirrorY: false, ssaa: 3
    },
    twill: {
      type: 'twill', tileW: 144, tileH: 144, lineWidth: 8,
      pitchX: 18, pitchY: 18,
      warpColor: '#7a4fa3', weftColor: '#d4a23c', bgColor: '#f6f0e4',
      mirrorX: false, mirrorY: false, ssaa: 3
    },
    satin: {
      type: 'satin', tileW: 160, tileH: 160, lineWidth: 10,
      pitchX: 20, pitchY: 20,
      warpColor: '#1f7a6d', weftColor: '#243b63', bgColor: '#f2ecdb',
      mirrorX: true, mirrorY: true, ssaa: 3
    }
  };

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /*
   * 无限平面坐标 -> 循环单元内局部坐标。
   * wrap（平铺）：周期为 period 的锯齿波。
   * mirror（镜像）：周期为 2*period 的三角波，相邻单元自动翻转衔接。
   */
  function toLocal(v, period, mirror) {
    if (mirror) {
      const m = mod(v, 2 * period);
      return m < period ? m : 2 * period - m;
    }
    return mod(v, period);
  }

  /* 交叉点上哪根纱在上：true=经纱覆盖纬纱 */
  function warpOnTop(type, col, row) {
    if (type === 'plain') {
      return mod(col + row, 2) === 0;
    }
    if (type === 'twill') {
      // 2/2 斜纹：每行交错点平移，形成连续斜线
      return mod(col - row, 4) < 2;
    }
    // 五枚缎纹：每行/列仅一个纬浮点，其余为经浮长
    return mod(row - 2 * col, 5) !== 0;
  }

  function weaveAt(lx, ly, p, colors) {
    const inWarp = mod(lx, p.pitchX) < p.lineWidth;
    const inWeft = mod(ly, p.pitchY) < p.lineWidth;
    if (!inWarp && !inWeft) return colors.bg;
    if (inWarp && !inWeft) return colors.warp;
    if (inWeft && !inWarp) return colors.weft;
    const col = Math.floor(lx / p.pitchX);
    const row = Math.floor(ly / p.pitchY);
    return warpOnTop(p.type, col, row) ? colors.warp : colors.weft;
  }

  /* 对无限平面上的连续坐标点采样，返回 RGB */
  function samplePlane(params, x, y, colors) {
    const lx = toLocal(x, params.tileW, params.mirrorX);
    const ly = toLocal(y, params.tileH, params.mirrorY);
    return weaveAt(lx, ly, params, colors);
  }

  /*
   * 渲染任意区域（可跨任意多个循环单元）。
   * offsetX/offsetY 为该区域在无限平面上的原点。
   * ssaa 为每像素超采样阶数，用于纱线边缘抗锯齿。
   */
  function renderRegion(params, width, height, offsetX, offsetY, ssaa) {
    const p = Object.assign({}, DEFAULTS, params);
    const n = Math.max(1, ssaa || p.ssaa || 1);
    const colors = {
      warp: hexToRgb(p.warpColor),
      weft: hexToRgb(p.weftColor),
      bg: hexToRgb(p.bgColor)
    };
    const data = new Uint8ClampedArray(width * height * 4);
    let idx = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < n; sy++) {
          const ay = (offsetY || 0) + py + (sy + 0.5) / n;
          for (let sx = 0; sx < n; sx++) {
            const ax = (offsetX || 0) + px + (sx + 0.5) / n;
            const c = samplePlane(p, ax, ay, colors);
            r += c[0]; g += c[1]; b += c[2];
          }
        }
        const k = n * n;
        data[idx++] = Math.round(r / k);
        data[idx++] = Math.round(g / k);
        data[idx++] = Math.round(b / k);
        data[idx++] = 255;
      }
    }
    return { width, height, data };
  }

  function renderTile(params) {
    const p = Object.assign({}, DEFAULTS, params);
    return renderRegion(p, p.tileW, p.tileH, 0, 0, p.ssaa);
  }

  /*
   * 可直接交给任意图片工具重复平铺的最小无缝单元：
   * wrap 模式周期 = tile 尺寸；mirror 模式三角波周期 = 2*tile 尺寸。
   */
  function getUnitSize(params) {
    const p = Object.assign({}, DEFAULTS, params);
    return {
      width: p.mirrorX ? 2 * p.tileW : p.tileW,
      height: p.mirrorY ? 2 * p.tileH : p.tileH
    };
  }

  /* 渲染导出用无缝循环单元（镜像时自动包含正反两个朝向） */
  function renderUnit(params) {
    const p = Object.assign({}, DEFAULTS, params);
    const size = getUnitSize(p);
    return renderRegion(p, size.width, size.height, 0, 0, p.ssaa);
  }

  return {
    PATTERN_TYPES, DEFAULTS, PRESETS,
    mod, hexToRgb, toLocal, warpOnTop,
    samplePlane, renderRegion, renderTile,
    getUnitSize, renderUnit
  };
});
