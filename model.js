/*
 * 锋面剖面内置样例数据与采样模型。
 * 同时支持浏览器 (window.FrontModel) 与 Node (module.exports)，便于自动化验证。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FrontModel = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 水平范围 0–1000 km，垂直范围 0–12 km
  var DOMAIN = { xMin: 0, xMax: 1000, zMin: 0, zMax: 12 };

  // 三层大气（低层 / 中层 / 高层）的代表高度（km）
  var LAYERS = [
    { id: 'low', name: '低层', z: 1.5, range: '0–3 km' },
    { id: 'mid', name: '中层', z: 5.0, range: '3–7 km' },
    { id: 'high', name: '高层', z: 9.5, range: '7–12 km' }
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // 三种锋面的几何与物理参数
  // frontX(z): 锋面在高度 z 处的水平位置（km）
  // coldSign: +1 表示冷空气在锋面左侧，-1 表示在右侧
  var FRONTS = {
    warm: {
      id: 'warm',
      name: '暖锋',
      frontX: function (z) { return 640 - 32 * z; },
      coldSign: -1, // 暖锋：冷空气在锋前（右侧）
      cloud: { type: 'layered', width: 150, top: 8 }
    },
    cold: {
      id: 'cold',
      name: '冷锋',
      frontX: function (z) { return 470 - 11 * z; },
      coldSign: 1, // 冷锋：冷空气在锋后（左侧）
      cloud: { type: 'cumulus', width: 60, top: 11 }
    },
    stationary: {
      id: 'stationary',
      name: '静止锋',
      frontX: function (z) { return 500 + 14 * Math.sin(z * 1.1); },
      coldSign: 1,
      cloud: { type: 'band', width: 100, top: 7 }
    }
  };

  // 温度场 (°C)：随高度递减 + 跨越锋面的温度对比
  function temperatureAt(x, z, frontId) {
    var f = FRONTS[frontId];
    var fx = f.frontX(z);
    // 距锋面的有符号距离（>0 在冷侧）
    var d = (fx - x) * f.coldSign;
    var across = smoothstep(-90, 90, d); // 0=暖侧 1=冷侧
    var base = 16 - 6.5 * z;             // 标准递减率
    var contrast = 9 * (0.5 - across) * 2; // 暖侧 +9°C，冷侧 -9°C
    return base + contrast;
  }

  // 气压场 (hPa)：指数递减 + 锋区附近弱扰动
  function pressureAt(x, z, frontId) {
    var f = FRONTS[frontId];
    var fx = f.frontX(z);
    var d = (x - fx) / 120;
    var perturb = -6 * Math.exp(-d * d); // 锋区为弱低压槽
    return 1013.25 * Math.exp(-z / 8.4) + perturb;
  }

  // 风场：按层给出风速 (m/s) 与风向 (°，气象风向)
  function windAt(x, z, frontId, layerIndex) {
    var f = FRONTS[frontId];
    var fx = f.frontX(z);
    var dist = Math.abs(x - fx);
    var jet = 14 * Math.exp(-(dist * dist) / (2 * 90 * 90)); // 锋区急流
    var baseSpeed = [6, 12, 22][layerIndex] + jet * [0.4, 0.8, 1.2][layerIndex];
    // 低层风指向锋区辐合，高层近似平行于锋
    var dir;
    if (layerIndex === 0) {
      dir = x < fx ? 270 : 90; // 低层：两侧对吹（辐合）
    } else if (layerIndex === 1) {
      dir = frontId === 'warm' ? 225 : (frontId === 'cold' ? 315 : 270);
    } else {
      dir = 270; // 高层西风
    }
    return { speed: baseSpeed, dir: dir };
  }

  // 在给定水平位置采样三层大气参数
  function sampleAt(x, frontId) {
    x = clamp(x, DOMAIN.xMin, DOMAIN.xMax);
    return LAYERS.map(function (layer, i) {
      return {
        layer: layer,
        temperature: temperatureAt(x, layer.z, frontId),
        pressure: pressureAt(x, layer.z, frontId),
        wind: windAt(x, layer.z, frontId, i)
      };
    });
  }

  return {
    DOMAIN: DOMAIN,
    LAYERS: LAYERS,
    FRONTS: FRONTS,
    temperatureAt: temperatureAt,
    pressureAt: pressureAt,
    windAt: windAt,
    sampleAt: sampleAt
  };
});
