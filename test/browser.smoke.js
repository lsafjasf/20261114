'use strict';

// 浏览器联动冒烟：用最小 DOM/Audio/Canvas stub 加载四个前端脚本，
// 验证 UI 绑定、三轮抓取流程与全部通过逻辑（无需真实浏览器）。

const elements = {};
function makeEl(id) {
  return {
    id,
    value: id === 'speed' ? 35 : 30,
    textContent: '',
    className: '',
    style: {},
    disabled: false,
    listeners: {},
    width: 640,
    height: 480,
    addEventListener(type, fn) { this.listeners[type] = fn; },
    classList: { toggle() {}, add() {}, remove() {} },
    prepend() {},
  };
}

const ids = ['pressure', 'speed', 'feedback', 'pressure-val', 'speed-val', 'feedback-val',
  'm-peak', 'm-hold', 'm-deform', 'm-slip', 'm-crush', 'm-overshoot', 'm-threshold', 'm-need',
  'slip-bar', 'deform-bar', 'start-btn', 'reset-btn', 'mute-btn', 'obj-title', 'obj-spec',
  'run-status', 'overall', 'log', 'stage',
  'chip-soft', 'chip-medium', 'chip-hard'];
for (const id of ids) elements[id] = makeEl(id);
const ctx2d = new Proxy({}, {
  get: (target, prop) => {
    if (prop === 'createRadialGradient') return () => ({ addColorStop() {} });
    return typeof prop === 'string' ? () => {} : undefined;
  },
  set: () => true,
});
elements.stage.getContext = () => ctx2d;

const tabs = [0, 1, 2].map((idx) => ({
  dataset: { idx: String(idx) },
  listeners: {},
  classList: { toggle() {} },
  addEventListener(type, fn) { this.listeners[type] = fn; },
}));

const windowObj = {
  AudioContext: function () {
    const node = () => ({ connect: () => node(), gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} },
      frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} } });
    return {
      state: 'running',
      currentTime: 0,
      sampleRate: 8000,
      destination: {},
      resume() {},
      createOscillator: () => ({ ...node(), type: '', start() {}, stop() {}, connect: () => node() }),
      createGain: () => node(),
      createBiquadFilter: () => ({ ...node(), type: '', connect: () => node() }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    };
  },
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') this._dom = fn; },
};
global.window = new Proxy(windowObj, {
  get(target, prop) { return prop in target ? target[prop] : global[prop]; },
  set(target, prop, value) { target[prop] = value; global[prop] = value; return true; },
});
global.performance = { now: () => Date.now() };
let rafCb = null;
global.requestAnimationFrame = (fn) => { rafCb = fn; return 1; };

global.document = {
  getElementById: (id) => elements[id],
  querySelectorAll: (sel) => (sel === '.obj-tab' ? tabs : []),
  createElement: () => makeEl('tmp'),
};

const path = require('node:path');
for (const f of ['sim.js', 'audio.js', 'renderer.js', 'app.js']) {
  let code = require('node:fs').readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  if (f === 'sim.js') {
    code += '\nglobalThis.OBJECTS = OBJECTS; globalThis.GAP = GAP; globalThis.evaluate = evaluate; globalThis.GraspSim = GraspSim;';
  } else if (f === 'audio.js') {
    code += '\nglobalThis.MotorAudio = MotorAudio;';
  } else if (f === 'renderer.js') {
    code += '\nglobalThis.Renderer = Renderer; globalThis.forceColor = forceColor;';
  }
  new Function('window', 'document', 'module', 'exports', 'globalThis', code)(
    global.window, global.document, { exports: {} }, {}, global);
}

global.window._dom();
const app = global.window.app;

const TUNED = {
  soft: { pressure: 20, speed: 20, feedback: 20 },
  medium: { pressure: 36, speed: 45, feedback: 36 },
  hard: { pressure: 65, speed: 60, feedback: 65 },
};

for (const objectId of ['soft', 'medium', 'hard']) {
  const idx = ['soft', 'medium', 'hard'].indexOf(objectId);
  tabs[idx].listeners.click();
  for (const [k, v] of Object.entries(TUNED[objectId])) {
    elements[k].value = String(v);
    elements[k].listeners.input();
  }
  elements['start-btn'].listeners.click();
  let now = Date.now();
  for (let i = 0; i < 400 && !app.sim.passed; i++) {
    const cb = rafCb;
    rafCb = null;
    now += 1000 / 60;
    cb(now);
  }
  if (!app.sim.passed) throw new Error(`${objectId} 未在 400 帧内通过`);
}

if (!elements.overall.textContent.includes('考核通过')) {
  throw new Error('未出现总考核通过提示');
}
console.log('浏览器联动冒烟通过：三轮抓取完成，提示：' + elements.overall.textContent);
