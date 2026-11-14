/* Node 冒烟测试：用桩替代 DOM/Canvas，实际执行 game.js 若干帧。 */
'use strict';

const ctx2d = new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return {};
    if (!(k in t)) t[k] = typeof k === 'string' ? function () {} : undefined;
    return t[k];
  },
  set(t, k, v) { t[k] = v; return true; },
});

function makeEl(id) {
  return {
    id, value: id === 'tension' ? '78' : id === 'spacing' ? '26' : '',
    textContent: '', disabled: false, style: {},
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    getContext() { return ctx2d; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 440 }; },
    width: 960, height: 440,
  };
}

const els = {};
global.window = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); },
};

let frames = 0;
const MAX_FRAMES = 60 * 40; // 模拟 40 秒
global.requestAnimationFrame = function (fn) {
  if (frames++ < MAX_FRAMES) setImmediate(() => fn(frames * 16.7));
};

global.BridgeSim = require('./bridge.js'); // 浏览器中由 bridge.js 挂到 window
require('./game.js');

// 点击加固跨中 4 块板
const cv = els.cv;
const ppm = (960 - 120) / (24 * 2);
for (const i of [10, 11, 12, 13]) {
  const mx = 60 + (i + 0.5) * 2 * ppm;
  cv.listeners.click.forEach(fn => fn({ clientX: mx, clientY: 260 }));
}
// 放行
els.startBtn.listeners.click.forEach(fn => fn());

setTimeout(() => {
  const st = els.status.textContent;
  console.log('帧数:', frames, ' 状态栏:', st);
  const ok = st.includes('全部救援车安全通过');
  console.log(ok ? '冒烟测试通过 ✅（默认参数全队通行）' : '冒烟测试未获胜 ❌');
  process.exit(ok ? 0 : 1);
}, 3000);
