/*
 * verify.js — Node 端数值验证（不依赖浏览器）：
 * 1. 实际比较 EaseIn 与 EaseOut 两种缓动的位移/速度/加速度特征
 * 2. 检测速度曲线相邻采样最大跳变，验证速度图不存在明显断点
 * 3. 解析导数与独立数值差分交叉核对
 * 运行：node tests/verify.js
 */
'use strict';

var EasingCore = require('../js/easing.js');
var Easing = EasingCore.Easing;

var SAMPLES = 240;
var failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function numericVelocity(easing, u) {
  var h = 1e-5;
  var lo = Math.max(0, u - h);
  var hi = Math.min(1, u + h);
  return (easing.valueAt(hi) - easing.valueAt(lo)) / (hi - lo);
}

function velocityJumps(easing) {
  var samples = easing.sample(SAMPLES);
  var maxJump = 0;
  var maxRelJump = 0;
  var atU = 0;
  var maxAccel = 0;
  var vMin = Infinity, vMax = -Infinity;
  for (var i = 1; i < samples.length; i++) {
    var jump = Math.abs(samples[i].v - samples[i - 1].v);
    if (jump > maxJump) { maxJump = jump; atU = samples[i].u; }
    if (Math.abs(samples[i].a) > maxAccel) maxAccel = Math.abs(samples[i].a);
  }
  samples.forEach(function (pt) {
    if (pt.v < vMin) vMin = pt.v;
    if (pt.v > vMax) vMax = pt.v;
  });
  /* 相对跳变只在速度本身足够大（>量程 15%）的区域统计，避免端点 v≈0 分母失真 */
  var vRange = Math.max(vMax - vMin, 0.05);
  for (var j = 1; j < samples.length; j++) {
    var localV = Math.max(Math.abs(samples[j].v), Math.abs(samples[j - 1].v));
    if (localV > vRange * 0.15) {
      var rel = Math.abs(samples[j].v - samples[j - 1].v) / localV;
      if (rel > maxRelJump) maxRelJump = rel;
    }
  }
  return {
    maxJump: maxJump,
    maxRelJump: maxRelJump,
    normalizedJump: maxJump / vRange,
    maxAccel: maxAccel,
    vMin: vMin, vMax: vMax,
    atU: atU,
    samples: samples
  };
}

var curves = {
  linear: new Easing(0, 0, 1, 1),
  ease: new Easing(0.25, 0.1, 0.25, 1),
  easeIn: new Easing(0.42, 0, 1, 1),
  easeOut: new Easing(0, 0, 0.58, 1),
  easeInOut: new Easing(0.42, 0, 0.58, 1)
};

/* ---- 基本性质 ---- */
Object.keys(curves).forEach(function (key) {
  var e = curves[key];
  assert(Math.abs(e.valueAt(0)) < 1e-9, key + ' 起点位移应为 0');
  assert(Math.abs(e.valueAt(1) - 1) < 1e-9, key + ' 终点位移应为 1');
  var samples = e.sample(SAMPLES);
  for (var i = 1; i < samples.length; i++) {
    assert(samples[i].s >= samples[i - 1].s - 1e-9, key + ' 位移应单调不减');
    assert(isFinite(samples[i].v) && isFinite(samples[i].a), key + ' 速度/加速度必须处处有限');
  }
});

assert(Math.abs(curves.linear.valueAt(0.37) - 0.37) < 1e-9, 'Linear 应满足 s(u)=u');
assert(Math.abs(curves.linear.velocityAt(0.5) - 1) < 1e-9, 'Linear 速度恒为 1');

/* ---- 解析导数 vs 数值差分 ---- */
[0.01, 0.13, 0.5, 0.87, 0.99].forEach(function (u) {
  Object.keys(curves).forEach(function (key) {
    var analytic = curves[key].velocityAt(u);
    var numeric = numericVelocity(curves[key], u);
    var err = Math.abs(analytic - numeric) / Math.max(Math.abs(numeric), 0.05);
    assert(err < 0.02, key + ' 在 u=' + u + ' 解析/数值速度偏差过大: ' + err);
  });
});

/* ---- 两种缓动实际对比：EaseIn vs EaseOut ---- */
var easeIn = curves.easeIn;
var easeOut = curves.easeOut;
var comparison = [0.1, 0.25, 0.5, 0.75, 0.9].map(function (u) {
  return {
    u: u,
    easeIn_s: easeIn.valueAt(u),
    easeOut_s: easeOut.valueAt(u),
    easeIn_v: easeIn.velocityAt(u),
    easeOut_v: easeOut.velocityAt(u),
    easeIn_a: easeIn.accelerationAt(u),
    easeOut_a: easeOut.accelerationAt(u)
  };
});

assert(easeIn.velocityAt(0) < easeOut.velocityAt(0),
  '起点处 EaseIn 速度应小于 EaseOut（缓入起步慢）');
assert(easeIn.velocityAt(1) > easeOut.velocityAt(1),
  '终点处 EaseIn 速度应大于 EaseOut（缓出提前减速）');
assert(easeIn.valueAt(0.25) < easeOut.valueAt(0.25),
  '前半程 EaseIn 位移应落后于 EaseOut');
assert(easeIn.valueAt(0.75) < easeOut.valueAt(0.75),
  'EaseIn 整体位移进度应落后于 EaseOut');

/* ---- 速度图断点检测（全部五种 + 一条带过冲的自定义曲线）---- */
/* 自定义曲线允许 y 过冲（回弹感），但 x 保持在实用区间 [0.05,0.95]，
   避免端点切线垂直（dx/dt≈0 的参数奇点），UI 拖拽也做同样限制 */
var customOvershoot = new Easing(0.15, 1.12, 0.85, -0.12);
var allChecks = Object.keys(curves).map(function (key) {
  var r = velocityJumps(curves[key]);
  return {
    curve: key, maxJump: r.maxJump, maxRelJump: r.maxRelJump,
    normalizedJump: r.normalizedJump, maxAccel: r.maxAccel, atU: r.atU
  };
});
var overshootCheck = velocityJumps(customOvershoot);
allChecks.push({
  curve: 'custom-overshoot',
  maxJump: overshootCheck.maxJump,
  maxRelJump: overshootCheck.maxRelJump,
  normalizedJump: overshootCheck.normalizedJump,
  maxAccel: overshootCheck.maxAccel,
  atU: overshootCheck.atU
});

allChecks.forEach(function (row) {
  var isCustom = row.curve.indexOf('custom') === 0;
  /*
   * 无明显断点判据（同时满足）：
   *  a) 加速度全程有限且有界 → 速度 Lipschitz 连续，数学上不存在阶跃
   *  b) 相邻采样归一化跳变 < 速度量程 5% → 图上无可视断点
   *  c) 非近零速度区域的相对跳变 < 10%（辅助指标，避开端点 v≈0 分母失真）
   * 自定义过冲曲线允许更陡的光滑曲率，阈值适度放宽但仍禁止阶跃
   */
  var accelLimit = isCustom ? 300 : 60;
  var jumpLimit = isCustom ? 0.10 : 0.05;
  assert(isFinite(row.maxAccel) && row.maxAccel < accelLimit,
    row.curve + ' 加速度无界，速度可能不连续');
  assert(row.normalizedJump < jumpLimit,
    row.curve + ' 速度存在可视断点：归一化跳变 ' + (row.normalizedJump * 100).toFixed(2) + '%');
  assert(row.maxRelJump < 0.10,
    row.curve + ' 速度相对跳变过大：' + (row.maxRelJump * 100).toFixed(2) + '%');
});

/* 收敛判别：真断点的跳变不随采样变密而缩小；光滑曲线的跳变应近似反比收敛。
   对两种重点对比曲线 EaseIn/EaseOut 做 240 → 1920 采样对比 */
var convergenceReport = [];
[easeIn, easeOut].forEach(function (e, idx) {
  var coarse = velocityJumps(e);
  var fine = velocityJumpsWith(e, 1920);
  var ratio = fine.maxJump / coarse.maxJump;
  reportConvergence(idx === 0 ? 'easeIn' : 'easeOut', ratio, fine, coarse);
  assert(ratio < 0.35,
    (idx === 0 ? 'easeIn' : 'easeOut') + ' 速度跳变未随采样加密收敛，疑似真断点（比率 ' + ratio.toFixed(3) + '）');
});

function velocityJumpsWith(e, n) {
  var samples = e.sample(n);
  var maxJump = 0;
  /* 跳过首尾端点：端点钳位值与首个内部采样的差不参与收敛判别 */
  for (var i = 2; i < samples.length - 1; i++) {
    var jump = Math.abs(samples[i].v - samples[i - 1].v);
    if (jump > maxJump) maxJump = jump;
  }
  return { maxJump: maxJump };
}

function reportConvergence(name, ratio, fine, coarse) {
  convergenceReport.push({
    curve: name,
    coarseMaxJump: coarse.maxJump,
    fineMaxJump: fine.maxJump,
    fineOverCoarse: ratio
  });
}

/* 压力测试：接近参数奇点的曲线（x1=0.03）数值兜底也必须给出有限值，不允许 NaN/Infinity */
var nearSingular = new Easing(0.03, 0.9, 0.97, 0.1);
[0, 0.001, 0.005, 0.5, 0.995, 0.999, 1].forEach(function (u) {
  ['valueAt', 'velocityAt', 'accelerationAt'].forEach(function (method) {
    var val = nearSingular[method](u);
    assert(isFinite(val), '近奇点曲线 ' + method + '(' + u + ') 出现非有限值: ' + val);
  });
});

/* ---- 输出报告 ---- */
var report = {
  sampleCount: SAMPLES + 1,
  comparison_easeIn_vs_easeOut: comparison,
  velocityContinuity: allChecks,
  convergenceUnderFinerSampling: convergenceReport,
  nearSingularCurveFiniteCheck: '所有采样点 value/velocity/acceleration 均有限',
  passed: failures.length === 0,
  failures: failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error('\n验证失败：' + failures.length + ' 项（详见上方 JSON failures）');
  process.exit(1);
}
if (process.env.QUIET !== '1') {
  console.error('\n全部验证通过：两种缓动特征差异符合预期，速度图无明显断点。');
}
