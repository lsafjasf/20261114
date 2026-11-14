// smoke_test.js — 用 DOM 桩在 Node 中冒烟执行 game.js 主流程
const Sim = require('./sim.js');

const ctxStub = new Proxy({}, {
  get: (t, k) => (k === 'canvas' ? {} : () => {}),
  set: () => true,
});
function makeEl() {
  return {
    value: 0, textContent: '', className: '', style: {}, disabled: false,
    innerHTML: '', children: [],
    onclick: null, oninput: null,
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); },
    getContext: () => ctxStub,
    width: 1160, height: 560,
    scrollTop: 0, scrollHeight: 0,
  };
}
const els = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = makeEl()); },
  createElement: () => makeEl(),
};
let rafCb = null;
global.window = {};
global.performance = { now: () => simNow };
global.requestAnimationFrame = (cb) => { rafCb = cb; };
global.self = global;
global.WaterSim = Sim;

let simNow = 0;
require('./game.js');

// 点击“开始运行”
els.startBtn.onclick();
if (!rafCb) { console.error('FAIL: 未启动主循环'); process.exit(1); }

// 推进 30 个现实秒（=120 模拟秒），期间调节控制量
for (let i = 0; i < 300; i++) {
  simNow += 100;
  const cb = rafCb; rafCb = null;
  cb(simNow);
  if (i === 50) { els.cDose.value = 25; els.cDose.oninput && els.cDose.oninput(); }
  if (!rafCb) break; // 模拟结束
}
console.log('game.js 冒烟通过：主循环、绘制、HUD、音频桩均无异常');

// 音频模块桩（无 AudioContext 时应安全跳过）
console.log('事件日志条数:', els.log.children.length);
process.exit(0);
