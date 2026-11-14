'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(tag) {
  return {
    tag,
    children: [],
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    innerHTML: '',
    classList: {
      add(c) { if (!this._c.includes(c)) this._c.push(c); },
      remove(c) { this._c = this._c.filter((x) => x !== c); },
      toggle(c, on) { on ? this.add(c) : this.remove(c); },
      _c: []
    },
    appendChild(c) { this.children.push(c); },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    querySelector() { return makeEl('x'); },
    querySelectorAll() { return []; },
    addEventListener() {},
    insertAdjacentHTML() {},
    getContext() {
      return new Proxy({}, { get: (t, prop) => {
        if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
        return typeof prop === 'string' ? () => {} : undefined;
      } });
    },
    width: 960,
    height: 560,
    scrollTop: 0,
    scrollHeight: 0
  };
}

const ids = {};
const documentStub = {
  getElementById(id) {
    if (!ids[id]) ids[id] = makeEl('div');
    return ids[id];
  },
  querySelector() { return makeEl('div'); },
  querySelectorAll() { return []; },
  createElement(tag) { return makeEl(tag); }
};

const listeners = {};
const sandbox = {
  console,
  document: documentStub,
  addEventListener() {},
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout,
  window: null,
  AudioContext: function () {
    return {
      state: 'running',
      sampleRate: 8000,
      currentTime: 0,
      destination: {},
      resume() {},
      createGain: () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {} }),
      createOscillator: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {}, start() {}, stop() {} }),
      createBufferSource: () => ({ buffer: null, loop: false, connect() {}, start() {}, stop() {} }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      createBiquadFilter: () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, Q: { value: 0 }, connect() {} })
    };
  }
};
sandbox.window = sandbox;
sandbox.document.addEventListener = () => {};
vm.createContext(sandbox);

for (const file of ['sim.js', 'pilot.js', 'audio.js', 'main.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
}

const game = sandbox.window.__pumpGame;
if (!game) throw new Error('main.js 未注册 __pumpGame');

const { sim, pilots } = game;
sim.start();
game.state.running = true;
game.state.demo = true;

const dt = 0.05;
let guard = 0;
while (sim.status === 'running' && guard < 40000) {
  pilots.valve.act(sim, dt);
  pilots.pump.act(sim, dt);
  sim.step(dt);
  guard++;
}

console.log('headless 演示结果:', sim.status, '用时', sim.t.toFixed(1) + 's',
  '水锤', sim.stats.hammerEvents, '气蚀', sim.stats.cavEvents);
if (sim.status !== 'won') {
  console.error('FAIL: 浏览器演示模式未能达成胜利');
  process.exit(1);
}
console.log('PASS: 完整前端栈（含 main.js 模块装配）可达成协作稳态胜利');
