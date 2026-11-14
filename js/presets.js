/*
 * presets.js — 五种内置缓动 + 用户自定义预设（localStorage 持久化）
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'easing-tool-custom-presets-v1';

  /* 五种内置缓动，全部以三次贝塞尔 (x1,y1,x2,y2) 表示 */
  var BUILTIN = [
    { id: 'linear',   name: 'Linear 线性',       p: [0, 0, 1, 1],       builtin: true },
    { id: 'ease',     name: 'Ease 缓入缓出',     p: [0.25, 0.1, 0.25, 1], builtin: true },
    { id: 'easeIn',   name: 'EaseIn 缓入',       p: [0.42, 0, 1, 1],    builtin: true },
    { id: 'easeOut',  name: 'EaseOut 缓出',      p: [0, 0, 0.58, 1],    builtin: true },
    { id: 'easeInOut', name: 'EaseInOut 缓入缓出', p: [0.42, 0, 0.58, 1], builtin: true }
  ];

  function loadCustom() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      return [];
    }
  }

  function saveCustom(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function isValidControlPoints(p) {
    return Array.isArray(p) && p.length === 4 &&
      p.every(function (n) { return typeof n === 'number' && isFinite(n); }) &&
      p[0] >= 0 && p[0] <= 1 && p[2] >= 0 && p[2] <= 1;
  }

  function PresetStore() {
    this.custom = loadCustom();
  }

  PresetStore.prototype.all = function () {
    return BUILTIN.concat(this.custom);
  };

  PresetStore.prototype.add = function (name, p) {
    if (!isValidControlPoints(p)) {
      throw new Error('控制点非法：x1/x2 必须在 [0,1]，且需要 4 个数值');
    }
    var preset = {
      id: 'custom-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      name: String(name || '未命名预设').slice(0, 40),
      p: p.slice(),
      builtin: false
    };
    this.custom.push(preset);
    saveCustom(this.custom);
    return preset;
  };

  PresetStore.prototype.remove = function (id) {
    this.custom = this.custom.filter(function (item) { return item.id !== id; });
    saveCustom(this.custom);
  };

  PresetStore.prototype.findById = function (id) {
    return this.all().filter(function (item) { return item.id === id; })[0] || null;
  };

  var api = { BUILTIN: BUILTIN, PresetStore: PresetStore, isValidControlPoints: isValidControlPoints };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.EasingPresets = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
