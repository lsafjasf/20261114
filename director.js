// 自动操作导演：完成「稳态调节」与「压力尖峰处理」两个科目。
// 同一套速率受限指令，浏览器与 Node 测试共用，保证演示可复现。

import { createSim, step, nudgeValve, fastClose, setPump, LIMITS } from './sim.js';

export function createDirector(sim) {
  return {
    phase: 'steady',
    stableTime: 0,
    steadyDone: false,
    spikeInjected: false,
    pumpRelieved: false,
    reopenDone: false,
    recoverTime: 0,
    spikeHandled: false,
    lastNudge: -99,
    phase1Stats: null,
  };
}

function safeSteady(sim, dir, dt) {
  // 压力优先保护：泵的静压贡献最大，先压泵
  if (sim.pressure > 7.0 && sim.pumpTarget > 0.1) {
    setPump(sim, Math.max(0.1, sim.pumpTarget - 0.1));
  }
  // 高压力且泵已很低：慢收阀门削减流量（正常速率，不产生尖峰）
  if (sim.pressure > 7.1 && sim.pump <= 0.12 && sim.t - dir.lastNudge > 0.5) {
    // 只收 V2/V3，保留 V1 开度，供后续快关科目产生足够行程的尖峰
    const idx = [1, 2].find((k) => sim.valves[k] > 0.5);
    if (idx >= 0) {
      nudgeValve(sim, idx, -0.1);
      dir.lastNudge = sim.t;
    }
  }
  // 高流量保护：避免把回路推过流量上限
  if (sim.flow > LIMITS.flow.warnHigh) {
    const idx = sim.valves.findIndex((v) => v > 0.55);
    if (idx >= 0) nudgeValve(sim, idx, -0.15);
    else if (sim.pumpTarget > 0.2) setPump(sim, Math.max(0.2, sim.pumpTarget - 0.15));
  }
  // 温度高于目标：优先慢开阀门（省电），阀门全开后再补泵
  if (sim.temp > 79 && sim.t - dir.lastNudge > 0.5) {
    const idx = sim.valves.findIndex((v) => v < 0.98);
    if (idx >= 0 && sim.flow < 8.5) {
      nudgeValve(sim, idx, 0.12);
      dir.lastNudge = sim.t;
    } else if (sim.pumpTarget < 0.6 && sim.flow < 8.5) {
      setPump(sim, Math.min(0.6, sim.pumpTarget + 0.08));
      dir.lastNudge = sim.t;
    }
  }
  // 流量裕量不足时补泵
  if (sim.flow < 2.4 && sim.pumpTarget < 0.55) {
    setPump(sim, Math.min(0.55, sim.pumpTarget + 0.12));
  }
}

export function directorTick(sim, dir, dt) {
  if (sim.failed) return dir;
  if (dir.phase === 'steady') {
    // 先观察温度告警再调节，体现“正在升温的交换节点”的处置过程
    safeSteady(sim, dir, dt);

    const inBand =
      sim.temp < 78 &&
      sim.temp > 10 &&
      sim.pressure < 7.4 &&
      sim.flow > 2.6 &&
      sim.flow < 9.0;
    // 必须等热负荷爬升到峰值（t>18s）后保持 2s，才算真正的稳态
    dir.stableTime = inBand && sim.t > 18 ? dir.stableTime + dt : 0;
    if (dir.stableTime >= 2.0) {
      dir.steadyDone = true;
      dir.phase1Stats = {
        t: sim.t,
        temp: sim.temp,
        pressure: sim.pressure,
        flow: sim.flow,
        battery: sim.battery,
      };
      dir.phase = 'preinject';
      dir.stableTime = 0;
      dir.lastNudge = sim.t;
      // 隔离规程：先减载降泵，再执行快关，避免在高静压下制造硬限值击穿
      setPump(sim, 0.1);
    }
    if (sim.t > 60) sim.running = false;
    return dir;
  }

  if (dir.phase === 'preinject') {
    if (Math.abs(sim.pump - 0.1) < 0.02 && sim.t - dir.lastNudge > 1.6) {
      dir.phase = 'inject';
    }
    return dir;
  }

  if (dir.phase === 'inject') {
    // 模拟误操作/紧急隔离：对 V1 执行一次快关，制造压力尖峰
    fastClose(sim, 0);
    dir.phase = 'mitigate';
    dir.lastNudge = sim.t;
    return dir;
  }

  if (dir.phase === 'mitigate') {
    if (!dir.pumpRelieved) {
      // 第一步：立即降泵，削减静压来源并节省备用电力
      setPump(sim, 0.2);
      dir.pumpRelieved = true;
    }
    // 第二步：以正常速率重开阀门泄压（不能再快关，否则二次尖峰）
    if (sim.t - dir.lastNudge > 0.3 && !dir.reopenDone) {
      nudgeValve(sim, 0, 0.9);
      dir.reopenDone = true;
    }
    const recovered =
      sim.spike < 0.15 && sim.pressure < LIMITS.pressure.warnHigh && sim.temp < 84;
    dir.recoverTime = recovered ? dir.recoverTime + dt : 0;
    if (dir.recoverTime >= 1.5) {
      dir.spikeHandled = true;
      dir.phase = 'done';
      sim.running = false;
    }
    if (sim.t > 90) sim.running = false;
    return dir;
  }
  return dir;
}

export function runMission(dt = 0.05, maxT = 100, onStep = null) {
  const sim = createSim();
  const dir = createDirector(sim);
  while (sim.running && !sim.failed && sim.t < maxT) {
    step(sim, dt);
    directorTick(sim, dir, dt);
    if (onStep) onStep(sim, dir);
  }
  return { sim, dir };
}
