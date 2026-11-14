/* 用最小 DOM 桩在 Node 中模拟浏览器，验证 app.js 完整交互链路 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const listeners = {};
function makeElement(id) {
  return {
    id: id,
    innerHTML: '',
    textContent: '',
    style: {},
    value: id === 'seed' ? '20261114' : 'linear',
    clientWidth: 1000,
    clientHeight: 420,
    width: 0,
    height: 0,
    children: [],
    appendChild(child) { this.children.push(child); },
    click() {},
    addEventListener(type, fn) {
      listeners[id + ':' + type] = fn;
      if (type === 'change') this._change = fn;
    },
    getContext() {
      return new Proxy({}, { get: () => () => undefined, set: () => true });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1000 }; }
  };
}

const ids = ['chart', 'tooltip', 'segment-list', 'legend-raw', 'legend-repaired',
  'stats', 'seed', 'regen', 'apply-all', 'bulk-strategy', 'compare', 'download'];
const elementMap = {};
ids.forEach(id => { elementMap[id] = makeElement(id); });

global.window = {
  devicePixelRatio: 1,
  addEventListener(type, fn) { listeners['window:' + type] = fn; },
  TempCore: require('../js/core.js')
};
global.window.TempChart = require('../js/chart.js');
global.document = {
  getElementById: id => elementMap[id],
  createElement: tag => makeElement(tag + '-' + Math.random().toString(36).slice(2, 7)),
  body: { appendChild() {}, removeChild() {} }
};
global.Blob = class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } };
const objectUrls = [];
global.URL = {
  createObjectURL: blob => { objectUrls.push(blob); return 'blob:fake'; },
  revokeObjectURL: () => {}
};

require('../js/app.js');
listeners['window:DOMContentLoaded']();

const app = global.window.__tempApp;
assert.ok(app.state.series, '初始化后应生成序列');
assert.ok(app.state.result, '初始化后应完成修复');

const segmentList = elementMap['segment-list'];
assert.strictEqual(segmentList.children.length, 4, '应渲染 4 个异常区间控件');
const firstSelect = segmentList.children[0].children[1];
assert.strictEqual(firstSelect.children.length, 3, '每个区间应有 3 种策略');

firstSelect.value = 'fforward';
firstSelect._change({ target: firstSelect });
assert.strictEqual(app.state.series.segments[0].strategy, 'fforward', '下拉切换应更新策略');

elementMap['bulk-strategy'].value = 'neighbor';
listeners['apply-all:click']();
assert.ok(app.state.series.segments.every(s => s.strategy === 'neighbor'), '批量策略应生效');

listeners['compare:click']();
assert.strictEqual(app.state.compare, true, '对照模式应开启');
listeners['compare:click']();
assert.strictEqual(app.state.compare, false, '对照模式应可关闭');

elementMap['seed'].value = '42';
listeners['regen:click']();
assert.strictEqual(app.state.series.points.length, 120, '重新生成仍为 120 个采样点');

listeners['download:click']();
assert.strictEqual(objectUrls.length, 1, '下载应创建一个 Blob URL');
const csvText = objectUrls[0].parts.join('');
const outFile = path.join(__dirname, 'browser-export-verify.csv');
fs.writeFileSync(outFile, csvText.replace(/^﻿/, ''));
const lines = fs.readFileSync(outFile, 'utf8').trim().split('\n');
assert.strictEqual(lines.length, 121, '浏览器链路导出的 CSV 应有 121 行');

listeners['chart:mousemove']({ clientX: 120, clientY: 80 });
assert.strictEqual(elementMap['tooltip'].style.display, 'block', '悬浮应显示提示框');
listeners['chart:mouseleave']();
assert.strictEqual(elementMap['tooltip'].style.display, 'none', '移出应隐藏提示框');

console.log('全部 app.js 交互冒烟检查通过，浏览器链路导出：' + outFile);
