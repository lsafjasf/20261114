/*
 * smoke.js — 用最小 DOM/localStorage 桩在 Node 中跑通主控逻辑：
 * 预设增删、时间线上传/定位、控制点修改后实时重算
 */
'use strict';

var storage = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function (k, v) { storage[k] = String(v); },
  removeItem: function (k) { delete storage[k]; }
};
global.devicePixelRatio = 1;

function makeCanvas() {
  return {
    width: 0, height: 0,
    getBoundingClientRect: function () { return { width: 400, height: 300, left: 0, top: 0 }; },
    getContext: function () {
      return new Proxy({}, {
        get: function (target, prop) {
          if (prop === 'setTransform' || prop === 'clearRect' || prop === 'fillText' ||
              prop === 'beginPath' || prop === 'moveTo' || prop === 'lineTo' ||
              prop === 'stroke' || prop === 'fill' || prop === 'arc' ||
              prop === 'setLineDash' || prop === 'strokeRect') {
            return function () {};
          }
          return target[prop];
        },
        set: function (target, prop, value) { target[prop] = value; return true; }
      });
    },
    addEventListener: function () {},
    style: {},
    setPointerCapture: function () {},
    releasePointerCapture: function () {}
  };
}

var elementStore = {};
function makeElement(id) {
  return {
    id: id,
    innerHTML: '',
    textContent: '',
    className: '',
    value: '',
    children: [],
    appendChild: function (child) { this.children.push(child); },
    addEventListener: function () {}
  };
}
['curveCanvas', 'trackCanvas', 'dispCanvas', 'velCanvas', 'accCanvas',
 'driverSelect', 'compareSelect', 'playBtn', 'pauseBtn', 'resetBtn',
 'presetName', 'savePresetBtn', 'presetList', 'uploadTimelineBtn',
 'clearTimelineBtn', 'playTimelineBtn', 'playSingleBtn',
 'timelineList', 'timelineInfo', 'continuity', 'pointReadout', 'legend'
].forEach(function (id) { elementStore[id] = makeElement(id); });

global.document = {
  readyState: 'complete',
  getElementById: function (id) {
    if (id.indexOf('Canvas') >= 0) return makeCanvas();
    return elementStore[id] || makeElement(id);
  },
  createElement: function () { return makeElement('dyn'); },
  addEventListener: function () {}
};
global.window = global;
global.addEventListener = function () {};

global.EasingCore = require('../js/easing.js');
global.EasingPresets = require('../js/presets.js');
global.EasingTimeline = require('../js/timeline.js');
global.EasingRender = require('../js/render.js');
require('../js/app.js');

var failures = [];
function assert(cond, msg) { if (!cond) failures.push(msg); }

var App = window.EasingApp;

/* 用可控时钟模拟 requestAnimationFrame，验证逐帧实时求解 */
var clock = 0;
var frameQueue = [];
global.requestAnimationFrame = function (cb) {
  clock += 100;
  var ts = clock;
  frameQueue.push(function () { if (App.state.playing) cb(ts); });
};
function flushFrames(n) {
  for (var i = 0; i < n && frameQueue.length; i++) {
    frameQueue.shift()();
  }
}
function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

/* 1. 初始渲染不报错，自检状态写入 DOM */
App.renderAll();
assert(elementStore.continuity.textContent.indexOf('通过') >= 0, '初始自检应显示通过');

/* 2. 保存自定义预设并持久化 */
App.state.controlPoints = [0.33, 0.66, 0.77, 0.22];
App.state.driverId = 'custom';
var before = App.store.custom.length;
App.store.add('冒烟预设', App.state.controlPoints.slice());
assert(App.store.custom.length === before + 1, '预设数量应增加');
assert(storage['easing-tool-custom-presets-v1'].indexOf('冒烟预设') >= 0, '预设应写入 localStorage');
App.renderAll();

/* 3. 时间线上传两个片段并验证 locate 定位 */
App.timeline.addClip({ name: '片段A', p: [0.42, 0, 1, 1] });
App.timeline.addClip({ name: '片段B', p: [0, 0, 0.58, 1] });
App.timeline.clips[0].durationMs = 1000;
App.timeline.clips[1].durationMs = 1000;
App.timeline.persist();
assert(App.timeline.totalDuration() === 2000, '时间线总时长应为 2000ms');
var loc1 = App.timeline.locate(500);
assert(loc1.index === 0 && Math.abs(loc1.localProgress - 0.5) < 1e-9, '500ms 应位于片段A中点');
var loc2 = App.timeline.locate(1500);
assert(loc2.index === 1 && Math.abs(loc2.localProgress - 0.5) < 1e-9, '1500ms 应位于片段B中点');
assert(storage['easing-tool-timeline-v1'].indexOf('片段A') >= 0, '时间线应持久化');

/* 4. 五种内置缓动 + 自定义曲线全部可实时求值且有限 */
App.currentCurves().forEach(function (curve) {
  for (var u = 0; u <= 1.0001; u += 0.05) {
    var uu = Math.min(1, u);
    [curve.easing.valueAt(uu), curve.easing.velocityAt(uu), curve.easing.accelerationAt(uu)]
      .forEach(function (v) { assert(isFinite(v), curve.id + ' 出现非有限值'); });
  }
});

/* 5. 速度连续性在自定义曲线上同样通过 */
var customEasing = App.buildEasing('custom', [0.33, 0.66, 0.77, 0.22]);
var check = App.velocityContinuity(customEasing);
assert(check.normalizedJump < 0.05, '自定义曲线归一化速度跳变应 <5%，实际 ' + check.normalizedJump);

/* 6. 模拟单条播放：rAF 逐帧驱动，进度必须单调增长到 1，且每帧数值由曲线实时求出 */
App.state.timelineMode = false;
App.state.durationMs = 1000;
App.state.progress = 0;
App.play();

(async function () {
  var seenProgress = [];
  for (var i = 0; i < 30 && App.state.playing; i++) {
    seenProgress.push(App.state.progress);
    flushFrames(1);
    await wait(15);
  }
  assert(seenProgress.length >= 5, '应产生至少 5 个播放帧，实际 ' + seenProgress.length);
  for (var k = 1; k < seenProgress.length; k++) {
    assert(seenProgress[k] >= seenProgress[k - 1], '播放进度应单调增长');
  }
  assert(Math.abs(App.state.progress - 1) < 1e-9, '单条播放应结束在 u=1');

  /* 7. 时间线播放：跨两个片段，片段序号发生切换 */
  App.state.timelineMode = true;
  App.state.timelineElapsed = 0;
  App.play();
  var clipIndices = [];
  for (var j = 0; j < 60 && App.state.playing; j++) {
    if (window._timelineLocal) clipIndices.push(window._timelineLocal.index);
    flushFrames(1);
    await wait(15);
  }
  assert(clipIndices.indexOf(0) >= 0 && clipIndices.indexOf(1) >= 0,
    '时间线播放应依次经过片段 0 和片段 1');
  assert(!App.state.playing && App.state.timelineElapsed >= 2000, '时间线应播放到末尾');

  console.log(JSON.stringify({
    frames: seenProgress.length,
    finalProgress: App.state.progress,
    timelineClipSwitch: clipIndices.indexOf(1) > clipIndices.indexOf(0),
    presets: App.store.custom.length,
    timelineClips: App.timeline.clips.length,
    totalDurationMs: App.timeline.totalDuration(),
    customNormalizedJump: check.normalizedJump,
    passed: failures.length === 0,
    failures: failures
  }, null, 2));

  if (failures.length) { process.exit(1); }
  console.error('冒烟测试通过');
})();
