(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnergySim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CONFIG = {
    duration: 20,
    equipment: { solarMax: 60, genMax: 50, batteryMax: 30 },
    lineCaps: { solar: 55, gen: 40, battery: 25, load: 70 },
    batteryKwh: 0.5,
    soc0: 0.5,
    tripSeconds: 3,
  };

  const SCENARIO = {
    name: '内置场景：午后云层 + 傍晚高峰',
    solarAvail: [55, 56, 58, 57, 55, 34, 20, 14, 18, 30, 46, 54, 56, 58, 57, 56, 55, 54, 52, 50],
    loadDemand: [34, 35, 36, 38, 42, 46, 52, 58, 63, 61, 56, 50, 47, 45, 46, 50, 56, 62, 60, 52],
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function createState() {
    return {
      t: 0,
      soc: CONFIG.soc0,
      overload: { solar: 0, gen: 0, battery: 0, load: 0 },
      status: 'running',
    };
  }

  // inputs: { solar, gen, battery } battery>0 放电, <0 充电（单一有符号量，物理上不可能同时充放）
  function tick(state, inputs) {
    if (state.status !== 'running') return null;
    const t = state.t;
    const avail = SCENARIO.solarAvail[t];
    const demand = SCENARIO.loadDemand[t];

    const solar = clamp(inputs.solar, 0, Math.min(CONFIG.equipment.solarMax, avail));
    const gen = clamp(inputs.gen, 0, CONFIG.equipment.genMax);

    // 电池：先按 SOC 约束截断，再取符号，保证充放互斥
    const maxDis = state.soc * CONFIG.batteryKwh * 3600;
    const maxChg = (1 - state.soc) * CONFIG.batteryKwh * 3600;
    let battCmd = clamp(inputs.battery, -CONFIG.equipment.batteryMax, CONFIG.equipment.batteryMax);
    if (battCmd > 0) battCmd = Math.min(battCmd, maxDis);
    else battCmd = -Math.min(-battCmd, maxChg);

    const batteryDischarge = Math.max(0, battCmd);
    let batteryCharge = 0;

    const supply = solar + gen + batteryDischarge;
    let delivered = 0;
    let curtailed = 0;
    let blackout = false;

    if (supply >= demand) {
      delivered = demand;
      const surplus = supply - demand;
      if (battCmd < 0) {
        batteryCharge = Math.min(-battCmd, surplus);
        curtailed = surplus - batteryCharge;
      } else {
        curtailed = surplus;
      }
    } else {
      delivered = supply;
      blackout = true;
    }

    state.soc += (batteryCharge - batteryDischarge) / 3600 / CONFIG.batteryKwh;
    state.soc = clamp(state.soc, 0, 1);

    // 守恒校验：供给 = 消纳 + 充电 + 弃电
    const imbalance = supply - (delivered + batteryCharge + curtailed);

    const lines = {
      solar: { flow: solar, cap: CONFIG.lineCaps.solar },
      gen: { flow: gen, cap: CONFIG.lineCaps.gen },
      battery: { flow: Math.abs(battCmd), cap: CONFIG.lineCaps.battery },
      load: { flow: delivered, cap: CONFIG.lineCaps.load },
    };
    let anyOverload = false;
    for (const k of Object.keys(lines)) {
      const L = lines[k];
      L.overload = L.flow > L.cap + 1e-9;
      state.overload[k] = L.overload ? state.overload[k] + 1 : 0;
      L.timer = state.overload[k];
      if (L.overload) anyOverload = true;
    }

    if (blackout) state.status = 'blackout';
    else if (Object.keys(lines).some((k) => state.overload[k] >= CONFIG.tripSeconds)) state.status = 'tripped';

    state.t += 1;
    if (state.status === 'running' && state.t >= CONFIG.duration) state.status = 'success';

    return {
      t, avail, demand, solar, gen, battCmd, batteryCharge, batteryDischarge,
      supply, delivered, curtailed, imbalance, blackout, anyOverload,
      soc: state.soc, lines, status: state.status,
    };
  }

  return { CONFIG, SCENARIO, createState, tick };
});
