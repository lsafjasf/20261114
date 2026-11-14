// 无头集成测试：用最小 DOM/Canvas/WebAudio 桩驱动真实主控逻辑，
// 验证 12 物体通过、连续三次失败停机、暂停时虚拟时钟与调度一起冻结。

import assert from 'node:assert/strict';

// ---- 最小 DOM 桩 ----
class El {
  constructor(id) {
    this.id = id;
    this.value = '35';
    this.textContent = '';
    this.style = {};
    this.listeners = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, evt = {}) { (this.listeners[type] || []).forEach((fn) => fn(evt)); }
  getContext() { return makeCtx2d(); }
  appendChild() {}
}

function makeCtx2d() {
  const noop = () => {};
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'canvas') return { width: 960, height: 380 };
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; },
  });
}

const elements = {};
const ids = [
  'stage', 'startBtn', 'pauseBtn', 'resetBtn', 'solveBtn',
  'passed', 'spawned', 'streak', 'status', 'controls',
];
for (let i = 0; i < 3; i += 1) {
  ids.push(`strength-${i}`, `offset-${i}`, `readout-${i}`);
}
for (const id of ids) elements[id] = new El(id);

// ---- 最小 WebAudio 桩：记录 suspend/resume/stop，验证暂停冻结 ----
class FakeNode {
  constructor(ctx) { this.ctx = ctx; this.gain = makeParam(); this.frequency = makeParam(); }
  connect(n) { return n; }
  start() { this.ctx.activeSources.push(this); }
  stop() { this.stopped = true; }
  cancelScheduledValues() {}
}
class FakeOsc extends FakeNode {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.onended = null; }
}
function makeParam() {
  return {
    value: 0,
    setValueAtTime() {}, exponentialRampToValueAtTime() {},
    linearRampToValueAtTime() {}, cancelScheduledValues() {},
  };
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
    this.activeSources = [];
  }
  createGain() { return new FakeNode(this); }
  createOscillator() { return new FakeOsc(this); }
  createBiquadFilter() {
    return { type: '', frequency: makeParam(), connect(n) { return n; } };
  }
  resume() { this.state = 'running'; }
  suspend() { this.state = 'suspended'; }
  close() { this.state = 'closed'; }
}

global.window = {
  addEventListener: noopGlobal,
  AudioContext: FakeAudioContext,
  devicePixelRatio: 1,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
global.performance = { now: () => clock };
global.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
global.cancelAnimationFrame = () => { rafQueue.length = 0; };

function noopGlobal() {}

// ---- 虚拟时钟 / RAF 驱动 ----
let clock = 0;
const rafQueue = [];
function pump(seconds, stepMs = 16) {
  const frames = Math.round(seconds * 1000 / stepMs);
  for (let f = 0; f < frames; f += 1) {
    clock += stepMs;
    const fn = rafQueue.shift();
    if (fn) fn(clock);
  }
}

global.document = {
  getElementById: (id) => elements[id],
  createElement: () => new El('dyn'),
};

const { App } = await import('../src/main.js');
const { SOLVED_PARAMS, DEFAULT_PARAMS } = await import('../src/core.js');

// 场景 A：默认参数 → 连续三次失败停机
clock = 0;
const appFail = new App();
appFail.start();
pump(30);
assert.equal(appFail.state.halted, true, '默认参数应在第三次撞门后停机');
assert.equal(appFail.state.failStreak, 3);
assert.equal(appFail.audio.ctx.state, 'suspended', '停机时音频应挂起');
console.log(`场景A 停机成功：连撞=${appFail.state.failStreak}，音频=${appFail.audio.ctx.state}`);

// 场景 B：已验证参数 → 12 个物体全部通过
clock = 0;
const app = new App();
app.applySolution();
assert.deepEqual(app.state.params, SOLVED_PARAMS);
app.start();
const vtAtStart = app.state.vt;

// 先跑 6 秒，中途暂停 2 秒，确认虚拟时钟冻结
pump(6);
const vtBeforePause = app.state.vt;
app.togglePause();
assert.equal(app.state.paused, true);
assert.equal(app.audio.ctx.state, 'suspended', '暂停时音频上下文必须挂起');
const wallBefore = clock;
app.state.flashes[0] = 0.7;   // 人为制造一个余辉，验证暂停期间不衰减
pump(2);
assert.equal(clock - wallBefore, 2000, '真实时间确实流逝了 2 秒');
assert.equal(app.state.vt, vtBeforePause, '暂停期间虚拟时间必须冻结');
assert.equal(app.audio.running, false, '暂停时音频调度必须停止');
assert.equal(app.state.flashes[0], 0.7, '暂停期间视觉余辉必须冻结不衰减');
console.log(`场景B 暂停冻结：真实+2.00s，虚拟时间保持 ${vtBeforePause.toFixed(2)}s`);

// 恢复后继续，直到全部通过
app.togglePause();
assert.equal(app.audio.ctx.state, 'running', '恢复后音频上下文继续');
pump(30);
assert.equal(app.state.won, true, '应达成全部通过');
assert.equal(app.state.passedCount, 12, '必须恰好通过 12 个物体');
assert.equal(app.state.failStreak, 0);
const crashed = app.state.objects.filter((o) => o.crashed).length;
assert.equal(crashed, 0, '不应有任何撞门');
console.log(`场景B 全部通过：${app.state.passedCount}/12，撞门=${crashed}，结束虚拟时刻=${app.state.vt.toFixed(2)}s`);

// 场景 C：暂停点恢复后音频按冻结 vt 重新对齐（nextPulse 不回退到过去）
app.reset();
app.applySolution();
app.start();
pump(3);
app.togglePause();
const frozenVt = app.state.vt;
app.togglePause();
// 锚点映射：toAudioTime 必须单调且把冻结 vt 映射到当前硬件时间附近
const mapped = app.audio.toAudioTime(frozenVt);
assert.ok(Math.abs(mapped - app.audio.ctx.currentTime) < 1e-6,
  '恢复后虚拟时间到硬件时间的锚点必须对齐');
app.audio.nextPulse.forEach((t, gi) => {
  assert.ok(t >= frozenVt - 1e-6, `闸门${gi + 1} 恢复后下一个脉冲不得早于冻结时刻`);
});
console.log('场景C 恢复后锚点对齐，脉冲从冻结点重新调度，无错位/重复音 ✔');

// 场景 D：重复点击启动不得叠加多个 RAF 循环（否则 vt 会以倍速前进）
clock = 0;
const appD = new App();
appD.applySolution();
appD.start();
appD.start();   // 再次启动应被忽略
appD.start();
pump(1);
const vt1 = appD.state.vt;
assert.ok(vt1 <= 1.05 && vt1 >= 0.95, `虚拟时间应按单倍速推进，实际 ${vt1}`);
console.log(`场景D 重复启动不叠加循环：1.00s 后 vt=${vt1.toFixed(2)}s（单倍速） ✔`);

console.log('\n无头集成测试全部通过 ✔');
