// DOM 级冒烟测试：node verify/dom-smoke.mjs
// jsdom 不实现 Canvas/Web Audio，这里用最小桩替身验证应用接线。
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const html = readFileSync(path.resolve('index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// Canvas 2D 上下文桩
class CtxStub {
  constructor() {
    this.calls = [];
  }
  fillRect() {}
  clearRect() {}
  fillText() {}
  beginPath() {}
  arc() {}
  fill() {}
  stroke() {}
  moveTo() {}
  lineTo() {}
  strokeRect() {}
  save() {}
  restore() {}
  createLinearGradient() {
    return { addColorStop() {} };
  }
  createRadialGradient() {
    return { addColorStop() {} };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(8) };
  }
  set fillStyle(v) {}
  get fillStyle() {
    return '';
  }
  set strokeStyle(v) {}
  get strokeStyle() {
    return '';
  }
  set font(v) {}
  get font() {
    return '';
  }
  set lineWidth(v) {}
  get lineWidth() {
    return 1;
  }
  set globalAlpha(v) {}
  get globalAlpha() {
    return 1;
  }
  set textAlign(v) {}
  get textAlign() {
    return 'left';
  }
}

window.HTMLCanvasElement.prototype.getContext = function getContext() {
  return new CtxStub();
};

// Web Audio 桩
class NodeStub {
  connect(node) {
    return node;
  }
  start() {}
  stop() {}
}
class AudioContextStub {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = {};
  }
  resume() {}
  createOscillator() {
    const node = new NodeStub();
    node.frequency = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      value: 0,
    };
    return node;
  }
  createGain() {
    const node = new NodeStub();
    node.gain = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      value: 0,
    };
    return node;
  }
  createBiquadFilter() {
    const node = new NodeStub();
    node.frequency = { value: 0 };
    node.Q = { value: 0 };
    node.type = '';
    return node;
  }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() {
    const node = new NodeStub();
    node.buffer = null;
    return node;
  }
}
window.AudioContext = AudioContextStub;

// requestAnimationFrame 桩：收集后手动取消，避免句柄泄漏
let rafSeq = 0;
const rafHandles = new Set();
window.requestAnimationFrame = (cb) => {
  const id = (rafSeq += 1);
  rafHandles.add(id);
  return id;
};
window.cancelAnimationFrame = (id) => rafHandles.delete(id);

globalThis.window = window;
globalThis.document = window.document;

let failures = 0;
function assert(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

const appUrl = pathToFileURL(path.resolve('src/app.js')).href;
const app = await import(appUrl);
const { state, runValidation, addAction, loadSchedule, startPlayback, resetPlayback } = app;

console.log('=== 页面初始化 ===');
assert('初始载入了可行排程（9 个动作）', state.actions.length === 9, String(state.actions.length));
assert('目标下拉有 3 颗星', document.getElementById('starSelect').options.length === 3);

console.log('=== 可行排程判定 ===');
runValidation();
assert('可行排程页面判定通过', state.result.passed === true);
assert(
  '结果区显示通过样式',
  document.getElementById('verdict').classList.contains('pass')
);
assert('日志输出了动作事件', document.getElementById('log').children.length > 0);

console.log('=== 迟到排程与错过窗口 ===');
const { badSchedule } = await import(
  pathToFileURL(path.resolve('src/engine.js')).href
);
loadSchedule(badSchedule);
runValidation();
assert('迟到排程页面判定失败', state.result.passed === false);
assert('结果区显示失败样式', document.getElementById('verdict').classList.contains('fail'));
assert(
  '错过 3 个窗口',
  state.result.missed.length === 3,
  JSON.stringify(state.result.missed.map((m) => m.name))
);
assert(
  '日志包含“错过窗口”文案',
  document.getElementById('log').textContent.includes('错过窗口')
);

console.log('=== 交互新增动作 ===');
document.getElementById('startInput').value = '5';
document.getElementById('durationInput').value = '2';
document.getElementById('starSelect').value = '2';
addAction('slew');
assert('新增转台动作后总数 +1', state.actions.length === 10);
assert('新动作按开始时间排序入列', state.actions.some((a) => a.start === 5));

console.log('=== 播放链路 ===');
startPlayback();
assert('播放状态置为 true', state.playing === true);
assert('已注册动画帧', rafHandles.size >= 1);
resetPlayback();
assert('复位后播放停止且时间归零', state.playing === false && state.t === 0);

console.log('\n=== 汇总 ===');
if (failures > 0) {
  console.error(`DOM 冒烟测试失败 ${failures} 项`);
  process.exit(1);
}
console.log('DOM 冒烟测试全部通过 ✅');
