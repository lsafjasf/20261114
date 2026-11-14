/* 纯逻辑核心：seed 漂移模型、单张判定、批次状态机。浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PressLogic = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_SEED = 20261114;
  var SHEETS_PER_JOB = 10;
  var TOLERANCE_MM = 0.15;      // 套准容差（径向）
  var TIGHT_TOLERANCE = 0.10;   // 着墨不足时收紧后的容差
  var PRESSURE_WRINKLE = 85;    // 超过则起皱报废
  var PRESSURE_STARVE = 30;     // 低于则着墨不足
  var MAX_WASTE = 3;            // 废纸超过则订单失败

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 固定 seed 生成整批 10 张的偏差趋势：缓坡 + 周期摆动 + 噪声，边缘逐渐放大 */
  function buildDriftTrend(seed) {
    var rng = mulberry32(seed);
    var slopeX = 0.02 + rng() * 0.03;   // 每张累计漂移
    var slopeY = -(0.015 + rng() * 0.025);
    var waveAmpX = 0.05 + rng() * 0.04;
    var waveAmpY = 0.04 + rng() * 0.04;
    var wavePhase = rng() * Math.PI * 2;
    var trend = [];
    for (var i = 0; i < SHEETS_PER_JOB; i++) {
      var edgeGain = 1 + (i / (SHEETS_PER_JOB - 1)) * 1.2; // 越往后边缘错位越明显
      trend.push({
        x: (slopeX * i + Math.sin(i * 0.9 + wavePhase) * waveAmpX * 0.4 +
            (rng() - 0.5) * 0.05) * edgeGain,
        y: (slopeY * i + Math.cos(i * 0.7 + wavePhase) * waveAmpY * 0.4 +
            (rng() - 0.5) * 0.05) * edgeGain
      });
    }
    return trend;
  }

  /* 单张判定：实际误差 = 机器漂移 - 玩家补偿；力度影响容差与起皱 */
  function evaluateSheet(drift, adjX, adjY, pressure, rng) {
    var jitter = rng ? (rng() - 0.5) * 0.02 : 0;
    var errX = drift.x - adjX + jitter;
    var errY = drift.y - adjY + (rng ? (rng() - 0.5) * 0.02 : 0);
    var err = Math.sqrt(errX * errX + errY * errY);
    var wrinkled = pressure > PRESSURE_WRINKLE;
    var starved = pressure < PRESSURE_STARVE;
    var tol = starved ? TIGHT_TOLERANCE : TOLERANCE_MM;
    var pass = !wrinkled && err <= tol;
    return {
      errX: errX, errY: errY, err: err,
      tolerance: tol, wrinkled: wrinkled, starved: starved, pass: pass
    };
  }

  /* 批次状态机：跑 10 张，统计良品/废纸，判定订单成败 */
  function createJob(seed) {
    var trend = buildDriftTrend(seed == null ? DEFAULT_SEED : seed);
    var rng = mulberry32((seed == null ? DEFAULT_SEED : seed) ^ 0x9E3779B9);
    return {
      seed: seed == null ? DEFAULT_SEED : seed,
      trend: trend,
      index: 0,
      good: 0,
      waste: 0,
      done: false,
      failed: false,
      history: [],
      printNext: function (adjX, adjY, pressure) {
        if (this.done) return null;
        var drift = this.trend[this.index];
        var res = evaluateSheet(drift, adjX, adjY, pressure, rng);
        var sheet = {
          no: this.index + 1, drift: drift,
          adj: { x: adjX, y: adjY, p: pressure }, result: res
        };
        this.history.push(sheet);
        if (res.pass) this.good++; else this.waste++;
        this.index++;
        if (this.waste > MAX_WASTE) { this.done = true; this.failed = true; }
        else if (this.index >= SHEETS_PER_JOB) {
          this.done = true;
          this.failed = this.good < SHEETS_PER_JOB - MAX_WASTE;
        }
        return sheet;
      }
    };
  }

  return {
    DEFAULT_SEED: DEFAULT_SEED,
    SHEETS_PER_JOB: SHEETS_PER_JOB,
    TOLERANCE_MM: TOLERANCE_MM,
    TIGHT_TOLERANCE: TIGHT_TOLERANCE,
    PRESSURE_WRINKLE: PRESSURE_WRINKLE,
    PRESSURE_STARVE: PRESSURE_STARVE,
    MAX_WASTE: MAX_WASTE,
    mulberry32: mulberry32,
    buildDriftTrend: buildDriftTrend,
    evaluateSheet: evaluateSheet,
    createJob: createJob
  };
});
