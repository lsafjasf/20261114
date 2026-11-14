// sim.js — 小型净水厂浊度控制模拟核心（纯模型，浏览器 / Node 通用）
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.WaterSim = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STANDARD_NTU = 1.0;     // 出水浊度标准 (NTU)
  const SIM_SECONDS = 20 * 60;  // 模拟时长：20 分钟
  const CLEAR_CAP = 1000;       // 清水库容量 (m3)
  const RAW_CAP = 100;          // 原水水库 (%)

  // 可复现的伪随机数
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 最佳混凝剂投加量：随原水浊度上升
  function optimalDose(rawNTU) { return 6 + rawNTU * 0.35; }

  function createSim(seed) {
    const rng = makeRng(seed || 20261114);
    return {
      t: 0,                    // 已模拟秒数
      over: false,
      success: false,
      rng,
      // 原水
      rawNTU: 55,              // 暴雨后的初始浊度
      rawStorage: 70,          // 原水水库水位 (%)
      rain: 1.0,               // 降雨强度系数（随时间衰减，偶有阵发）
      // 玩家控制
      dose: 20,                // 混凝剂投加量 (mg/L)
      sedTime: 18,             // 沉淀时间 (min)
      filterSpeed: 6,          // 滤速 (m/h)
      // 工艺状态
      flocQuality: 0.5,        // 絮体质量 0~1
      settledNTU: 10,
      effluentNTU: 1,
      headloss: 10,            // 滤池水头损失 (%)
      backwashLeft: 0,         // 反冲洗剩余秒数
      sludge: 20,              // 污泥压力 (%)
      desludgeLeft: 0,         // 排泥剩余秒数
      sludgeAlarm: false,
      // 清水侧
      storage: 620,            // 清水库存 (m3)
      demand: 40,              // 需水量 (m3/min)
      flow: 0,                 // 实际产水量 (m3/min)
      throttled: false,        // 原水不足被迫降产
      rationing: false,        // 清水不足被迫限供
      // 统计
      compliantTime: 0,
      breakthroughs: 0,
      dryOut: false,
      events: [],              // {t, type, msg}
      _breaking: false,
    };
  }

  function logEvent(s, type, msg) {
    const last = s.events[s.events.length - 1];
    if (last && last.type === type && s.t - last.t < 20) return; // 防抖
    s.events.push({ t: s.t, type, msg });
  }

  // 推进 dt 秒（建议 dt = 1）
  function step(s, dt) {
    if (s.over) return s;
    const rng = s.rng;
    s.t += dt;

    // ---- 原水：暴雨洪峰衰减 + 随机阵雨回弹 ----
    s.rain = Math.max(0.15, s.rain - dt * 0.0006);
    if (rng() < dt * 0.004) {
      s.rain = Math.min(1.2, s.rain + 0.35 + rng() * 0.3);
      logEvent(s, 'rain', '阵雨来袭，原水浊度回升');
    }
    const targetNTU = 8 + 70 * s.rain;
    s.rawNTU += (targetNTU - s.rawNTU) * (dt / 90) + (rng() - 0.5) * dt * 0.6;
    s.rawNTU = clamp(s.rawNTU, 4, 120);

    // ---- 混凝：投加量偏离最佳值则絮体质量下降 ----
    const opt = optimalDose(s.rawNTU);
    const ratio = s.dose / opt;
    s.flocQuality = clamp(Math.exp(-Math.pow(ratio - 1, 2) / 0.28), 0.05, 1);

    // ---- 沉淀：时间越长去除越充分；污泥满载则效率恶化 ----
    const sludgeFactor = s.sludgeAlarm ? 0.6 : 1;
    const sedRemoval = s.flocQuality * (1 - Math.exp(-s.sedTime / 8)) * 0.99 * sludgeFactor;
    s.settledNTU = s.rawNTU * (1 - sedRemoval);

    // ---- 过滤：滤速越快、水头损失越高，截留越差 ----
    const backwashing = s.backwashLeft > 0;
    if (backwashing) s.backwashLeft = Math.max(0, s.backwashLeft - dt);
    const leak = 0.04 * Math.exp(s.filterSpeed / 8) +
      Math.pow(s.headloss / 100, 3) * 0.4;
    s.effluentNTU = Math.max(0.05, s.settledNTU * clamp(leak, 0.005, 1));

    // 滤池穿透判定：水头损失过高或滤速过快导致出水超标
    const breaking = s.effluentNTU > STANDARD_NTU &&
      (s.headloss > 80 || s.filterSpeed > 9.5);
    if (breaking && !s._breaking) {
      s.breakthroughs += 1;
      logEvent(s, 'breakthrough', '滤池穿透！出水浊度超标');
    }
    s._breaking = breaking;

    // 水头损失增长（截留杂质累积），反冲洗时快速回落
    if (backwashing) {
      s.headloss = Math.max(5, s.headloss - dt * 6);
    } else {
      s.headloss = clamp(s.headloss +
        dt * s.flow * Math.max(0, s.settledNTU - s.effluentNTU) * 0.0004, 5, 100);
    }

    // ---- 污泥：投药越多、原水越浑，污泥压力越大 ----
    const desludging = s.desludgeLeft > 0;
    if (desludging) {
      s.desludgeLeft = Math.max(0, s.desludgeLeft - dt);
      s.sludge = Math.max(8, s.sludge - dt * 3.5);
    } else {
      s.sludge = clamp(s.sludge +
        dt * s.flow * s.dose * s.rawNTU * 0.0000012, 0, 100);
    }
    if (s.sludge >= 100 && !s.sludgeAlarm) {
      s.sludgeAlarm = true;
      logEvent(s, 'sludge', '污泥压力过高！沉淀效率下降，请排泥');
    }
    if (s.sludge < 85) s.sludgeAlarm = false;

    // ---- 产能：受沉淀时间、滤速、反冲洗、污泥与原水储量约束 ----
    const sedCap = 1100 / s.sedTime;          // 沉淀池通过能力 (m3/min)
    const filterCap = s.filterSpeed * 9;      // 滤池通过能力
    let flow = Math.min(sedCap, filterCap, 80) * sludgeFactor;
    if (backwashing) flow *= 0.55;
    s.rawStorage = clamp(s.rawStorage + dt * (s.rain * 0.3 - flow * 0.003), 0, RAW_CAP);
    s.throttled = s.rawStorage < 15;
    if (s.throttled) {
      flow *= Math.max(0.15, s.rawStorage / 15);
      logEvent(s, 'throttle', '原水储量不足，被迫降低产水');
    }
    s.flow = flow;

    // ---- 清水库：产水 - 需水 ----
    s.demand = 38 + 14 * Math.sin(s.t / 240) + rng() * 6;
    let demand = s.demand;
    s.rationing = s.storage < 120;
    if (s.rationing) {
      demand *= 0.55;
      logEvent(s, 'ration', '清水库存偏低，被迫限供');
    }
    s.storage = clamp(s.storage + (flow - demand) * dt / 60, 0, CLEAR_CAP);
    if (s.storage <= 0.5) s.dryOut = true;

    // ---- 达标统计与结束判定 ----
    if (s.effluentNTU <= STANDARD_NTU) s.compliantTime += dt;
    if (s.t >= SIM_SECONDS) {
      s.over = true;
      const compliantRatio = s.compliantTime / SIM_SECONDS;
      s.success = compliantRatio >= 0.9 &&
        s.storage >= CLEAR_CAP * 0.25 && !s.dryOut;
    }
    return s;
  }

  return {
    STANDARD_NTU, SIM_SECONDS, CLEAR_CAP,
    optimalDose, createSim, step,
    backwash(s) { if (s.backwashLeft <= 0) { s.backwashLeft = 30; logEvent(s, 'backwash', '开始反冲洗滤池'); } },
    desludge(s) { if (s.desludgeLeft <= 0) { s.desludgeLeft = 25; logEvent(s, 'desludge', '开始排泥'); } },
  };
});
