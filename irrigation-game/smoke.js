// 冒烟测试：用 DOM/Canvas 桩在 Node 中运行 game.js，验证渲染与主循环无运行时错误。
const fs = require('fs');
const path = require('path');

const handlers = {};
function makeEl(id) {
  return {
    id, value: '0', textContent: '', style: {},
    addEventListener: (ev, fn) => { (handlers[id + ':' + ev] = handlers[id + ':' + ev] || []).push(fn); },
  };
}
const gradient = { addColorStop() {} };
const ctx2d = new Proxy({}, {
  get(t, p) {
    if (p === 'createLinearGradient') return () => gradient;
    if (p === 'measureText') return () => ({ width: 0 });
    if (typeof t[p] !== 'undefined') return t[p];
    return () => {};
  },
  set(t, p, v) { t[p] = v; return true; },
});
const canvas = makeEl('cv');
canvas.width = 960; canvas.height = 560;
canvas.getContext = () => ctx2d;

const els = {};
global.document = {
  getElementById(id) {
    if (id === 'cv') return canvas;
    return els[id] || (els[id] = makeEl(id));
  },
  addEventListener: (ev, fn) => { (handlers['doc:' + ev] = handlers['doc:' + ev] || []).push(fn); },
};
let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.window = global;
global.self = global;

// 音频桩
const audioParam = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {} });
global.AudioContext = class {
  constructor() { this.sampleRate = 44100; this.currentTime = 0; this.destination = {}; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return { buffer: null, loop: false, connect() {}, start() {} }; }
  createBiquadFilter() { return { type: '', frequency: audioParam(), connect() {} }; }
  createGain() { return { gain: audioParam(), connect() {} }; }
  createOscillator() { return { frequency: audioParam(), connect() {}, start() {}, stop() {} }; }
};

const Sim = require('./sim.js');
global.Sim = Sim;
eval(fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8'));

// 点击「开始」
(handlers['btnStart:click'] || []).forEach((f) => f());
// 模拟玩家：推进 200 帧，并周期性调整滑块
let ts = 0;
for (let i = 0; i < 200; i++) {
  ts += 50;
  if (i % 20 === 0) {
    els.gIntake.value = String(30 + (i % 60));
    (handlers['gIntake:input'] || []).forEach((f) => f());
    els.gDivert.value = '80';
    (handlers['gDivert:input'] || []).forEach((f) => f());
  }
  if (i % 30 === 0) (handlers['doc:keydown'] || []).forEach((f) => f({ key: 'e' }));
  const cb = rafCb; rafCb = null; cb(ts);
}
console.log('smoke OK: game.js 渲染与主循环 200 帧无异常');
