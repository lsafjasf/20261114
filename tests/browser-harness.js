// 用最小 DOM/Canvas 桩在 Node 中加载浏览器脚本，验证调用链
const S = require('../js/simulation.js');

function makeEl(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    value: id === 'budget-input' ? '1800' : id === 'speed-multiplier' ? '2' : '',
    disabled: false,
    width: 720,
    height: 600,
    children: [],
    style: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(child) { this.children.push(child); },
    querySelectorAll() { return this._selects || []; },
    addEventListener(type, fn) { this._on = this._on || {}; this._on[type] = fn; },
    getContext() {
      return new Proxy({}, {
        get: (t, prop) => {
          if (prop === 'canvas') return {};
          return typeof prop === 'string' ? () => {} : undefined;
        },
        set: () => true,
      });
    },
  };
  el.parentElement = el;
  return el;
}

const ids = ['scene', 'hud-time', 'hud-delivered', 'hud-energy', 'hud-budget',
  'hud-starts', 'hud-complaints', 'hud-wait', 'car-controls', 'budget-input',
  'speed-multiplier', 'btn-start', 'btn-pause', 'btn-reset', 'btn-mute',
  'btn-compare', 'result-card', 'compare-card', 'legend'];
const elMap = Object.fromEntries(ids.map((id) => [id, makeEl(id)]));

const selectValues = [];
for (let i = 0; i < 3; i++) {
  for (const k of ['speed', 'strategy', 'home']) {
    selectValues.push({ dataset: { i: String(i), k },
      value: k === 'speed' ? 'medium' : k === 'strategy' ? 'collective' : String([1, 4, 7][i]),
      disabled: false });
  }
}
elMap['car-controls'].querySelectorAll = () => selectValues;

global.window = global;
global.self = global;
global.ElevatorSim = S;
let clockNow = 0;
global.performance = { now: () => clockNow };
let rafQueue = [];
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
global.cancelAnimationFrame = () => { rafQueue = []; };
global.AudioContext = class {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  resume() {}
  createOscillator() {
    return { type: '', frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {} },
      connect() { return this; }, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 0, setValueAtTime() {}, setTargetAtTime() {},
      exponentialRampToValueAtTime() {} }, connect() { return this; } };
  }
};

require('../js/audio.js');
require('../js/renderer.js');
global.document = {
  getElementById: (id) => elMap[id],
  createElement: () => {
    const el = makeEl('dynamic');
    el.querySelectorAll = () => [];
    return el;
  },
};

require('../js/main.js');

// 模拟点击「开始一局」，并驱动若干帧
elMap['btn-start']._on.click();
assert(elMap['btn-start'].disabled === true, '开始后按钮应禁用');
for (let frame = 0; frame < 6000; frame++) {
  const fns = rafQueue;
  rafQueue = [];
  clockNow += 100; // 每帧 100ms，配合 2× 倍速
  fns.forEach((fn) => fn());
  if (rafQueue.length === 0) break;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
assert(elMap['result-card'].innerHTML.includes('本局结果'), '应展示结果卡片');
assert(/成功|失败/.test(elMap['result-card'].innerHTML), '结果卡片含成功/失败');

// 对比按钮
elMap['btn-compare']._on.click();
assert(elMap['compare-card'].innerHTML.includes('回位策略 A/B 对比'), '应展示对比卡片');
assert(elMap['compare-card'].innerHTML.includes('大堂回位'), '含大堂回位');
assert(elMap['compare-card'].innerHTML.includes('分区回位'), '含分区回位');

// 复位
elMap['btn-reset']._on.click();
assert(elMap['btn-start'].disabled === false, '复位后可重新开始');

console.log('浏览器脚本桩测试通过 ✔');
