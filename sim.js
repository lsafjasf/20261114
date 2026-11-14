// 空间站冷却回路仿真内核
// 纯函数式状态机，可在 Node（无头测试）与浏览器（Canvas 可视化）中运行。

export const LIMITS = {
  temp: { low: 8, high: 92, warnHigh: 85, hold: 4.0 },
  pressure: { low: 1.8, high: 8.2, warnHigh: 7.4, warnLow: 2.4, hold: 2.0 },
  flow: { low: 1.0, high: 9.5, warnLow: 1.6, warnHigh: 9.0, hold: 3.0 },
};

const T_IN = 12;          // 散热器入口冷却液温度 ℃
const T_TAU = 8;          // 节点热惯性时间常数 s
const K_TEMP = 0.72;      // 温升系数
const FLOW_TAU = 1.8;     // 流量响应延迟 s
const VALVE_RATE = 0.22;  // 正常阀速 开度/s
const VALVE_FAST = 1.15;  // 快关速率 开度/s
const PUMP_RATE = 0.35;   // 泵速率限制 转速/s
const PUMP_DRAIN = 1.8;   // 满速泵电力消耗 %/s
const SPIKE_GAIN = 4.2;   // 快关位移 -> 压力尖峰增益 (bar / 单位开度)
const SPIKE_TAU = 0.9;    // 尖峰自然泄压时间常数 s

function targetFlow(valves, pump) {
  return 3.0 * valves.reduce((a, b) => a + b, 0) + 2.2 * pump;
}

function staticPressure(flow, pump) {
  return 1.5 + 0.75 * flow + 0.6 * pump;
}

export function createSim(opts = {}) {
  // 故障初始工况：阀门开度不足、泵低速，流量带不走热负荷，节点正在升温
  const valves = [0.32, 0.28, 0.24];
  const pump0 = 0.18;
  const flow0 = targetFlow(valves, pump0);
  return {
    t: 0,
    running: true,
    valves,
    valveTarget: [...valves],
    valveFast: [false, false, false],
    pump: pump0,
    pumpTarget: pump0,
    flow: flow0,
    spike: 0,
    pressure: staticPressure(flow0, pump0),
    temp: 70,
    heat: 380,
    battery: 100,
    viol: { temp: 0, pressure: 0, flow: 0 },
    warn: { temp: false, pressure: false, flow: false },
    failed: false,
    failReason: null,
    events: [],
    metrics: {
      maxTemp: 70,
      maxPressure: staticPressure(flow0, pump0),
      minFlow: flow0,
      energy: 0,
      spikeCount: 0,
      spikePeak: 0,
    },
  };
}

export function nudgeValve(sim, i, delta) {
  if (sim.failed) return;
  sim.valveFast[i] = false;
  sim.valveTarget[i] = Math.min(1, Math.max(0, sim.valveTarget[i] + delta));
}

export function fastClose(sim, i) {
  if (sim.failed) return;
  sim.valveFast[i] = true;
  sim.valveTarget[i] = 0;
  sim.events.push({ t: sim.t, type: 'fast-close', text: `阀 V${i + 1} 紧急快关` });
}

export function setPump(sim, target) {
  if (sim.failed) return;
  sim.pumpTarget = Math.min(1, Math.max(0, target));
}

function pushEvent(sim, type, text) {
  sim.events.push({ t: sim.t, type, text });
  if (sim.events.length > 60) sim.events.shift();
}

export function step(sim, dt) {
  if (sim.failed || !sim.running) return sim;
  dt = Math.min(dt, 0.1);
  const sub = Math.max(1, Math.ceil(dt / 0.05));
  const h = dt / sub;
  for (let s = 0; s < sub; s++) integrate(sim, h);
  return sim;
}

function integrate(sim, dt) {
  sim.t += dt;
  // 热负荷在 18s 内由 380kW 爬升至 560kW（交换节点正在升温）
  sim.heat = 380 + 180 * Math.min(1, sim.t / 18);

  // 阀门以受限速率向目标开度运动；快关注入压力尖峰
  for (let i = 0; i < 3; i++) {
    const before = sim.valves[i];
    const rate = sim.valveFast[i] ? VALVE_FAST : VALVE_RATE;
    const diff = sim.valveTarget[i] - sim.valves[i];
    const move = Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    sim.valves[i] += move;
    if (Math.abs(sim.valves[i] - sim.valveTarget[i]) < 1e-4) sim.valveFast[i] = false;
    // 仅“快关”动作注入压力尖峰：尖峰与关阀位移成正比
    if (sim.valveFast[i] && sim.valves[i] < before) {
      sim.spike += SPIKE_GAIN * (before - sim.valves[i]);
      sim.metrics.spikeCount++;
    }
  }

  // 旁路泵转速受限变化，消耗备用电力
  const pdiff = sim.pumpTarget - sim.pump;
  sim.pump += Math.sign(pdiff) * Math.min(Math.abs(pdiff), PUMP_RATE * dt);
  const drain = sim.pump * PUMP_DRAIN * dt;
  sim.battery = Math.max(0, sim.battery - drain);
  sim.metrics.energy += drain;

  // 流量一阶滞后：调节不会立刻生效
  const fTarget = targetFlow(sim.valves, sim.pump);
  sim.flow += ((fTarget - sim.flow) / FLOW_TAU) * dt;

  // 尖峰泄压：阀门越开、泵越低，泄压越快（处置动作有真实意义）
  const sumAfter = sim.valves.reduce((a, b) => a + b, 0);
  const reliefRate = (1 / SPIKE_TAU) + 0.35 * sumAfter + 0.3 * (1 - sim.pump);
  sim.spike = Math.max(0, sim.spike - reliefRate * sim.spike * dt);

  sim.pressure = staticPressure(sim.flow, sim.pump) + sim.spike;

  // 节点温度：热惯性一阶收敛到稳态温升
  const tSteady = T_IN + (K_TEMP * sim.heat) / Math.max(0.5, sim.flow);
  sim.temp += ((tSteady - sim.temp) / T_TAU) * dt;

  checkLimits(sim, dt);

  sim.metrics.maxTemp = Math.max(sim.metrics.maxTemp, sim.temp);
  sim.metrics.maxPressure = Math.max(sim.metrics.maxPressure, sim.pressure);
  sim.metrics.minFlow = Math.min(sim.metrics.minFlow, sim.flow);
  sim.metrics.spikePeak = Math.max(sim.metrics.spikePeak, sim.spike);

  if (sim.battery <= 0) fail(sim, '备用电力耗尽，旁路泵停机');
}

function checkLimits(sim, dt) {
  const L = LIMITS;
  const checks = [
    ['temp', sim.temp, L.temp],
    ['pressure', sim.pressure, L.pressure],
    ['flow', sim.flow, L.flow],
  ];
  for (const [key, value, lim] of checks) {
    const out = value > lim.high || value < lim.low;
    sim.viol[key] = out ? sim.viol[key] + dt : 0;
    const warn =
      value > (lim.warnHigh ?? lim.high) ||
      (lim.warnLow !== undefined && value < lim.warnLow);
    if (warn && !sim.warn[key]) {
      sim.warn[key] = true;
      const name = { temp: '节点温度', pressure: '回路压力', flow: '回路流量' }[key];
      pushEvent(sim, 'warn', `${name}逼近越限`);
    } else if (!warn) {
      sim.warn[key] = false;
    }
    if (sim.viol[key] >= lim.hold) {
      const name = { temp: '节点温度', pressure: '回路压力', flow: '回路流量' }[key];
      fail(sim, `${name}持续越限超过 ${lim.hold}s`);
    }
  }
}

function fail(sim, reason) {
  if (sim.failed) return;
  sim.failed = true;
  sim.failReason = reason;
  sim.running = false;
  pushEvent(sim, 'fail', `任务失败：${reason}`);
}

export function snapshot(sim) {
  return {
    t: sim.t,
    temp: sim.temp,
    pressure: sim.pressure,
    flow: sim.flow,
    spike: sim.spike,
    battery: sim.battery,
    pump: sim.pump,
    valves: [...sim.valves],
    heat: sim.heat,
    viol: { ...sim.viol },
    warn: { ...sim.warn },
    failed: sim.failed,
  };
}
