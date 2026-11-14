// 山区灌溉渠仿真核心：纯逻辑，无 DOM，可同时被浏览器和 Node 测试使用。
(function (root, factory) {
  const Sim = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  else root.Sim = Sim;
})(typeof self !== 'undefined' ? self : this, function () {
  const CFG = {
    dt: 0.1,             // 仿真步长（秒）
    timeLimit: 150,      // 总时限（秒）
    gateRate: 0.25,      // 闸门惯性：开度每秒最大变化量（全程约 4 秒）
    sensorInterval: 2.0, // 传感器更新间隔（秒）
    sourceBase: 2.2,     // 山溪基础流量
    surgeMag: 1.5,       // 山洪额外流量
    sluiceMax: 2.8,      // 泄洪闸全开流量
    seep: 0.015,         // 农田渗漏（水位/秒）
    leak: 0.18,          // 蓄水池向下游的生态基流（流量）
    reservoir: { area: 30, hMin: 1.2, hMax: 3.0, h0: 1.5 },
    fields: [
      { name: '田一', area: 28, lo: 0.9, hi: 1.3, max: 1.75, l0: 0.3 },
      { name: '田二', area: 36, lo: 1.0, hi: 1.5, max: 1.95, l0: 0.2 },
      { name: '田三', area: 46, lo: 1.1, hi: 1.7, max: 2.2, l0: 0.2 },
    ],
  };

  // 确定性随机数（便于测试复现）
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createState(seed) {
    const rng = mulberry32(seed == null ? (Date.now() & 0xffffffff) : seed);
    return {
      t: 0,
      rng,
      gates: {
        intake: { cur: 0, tgt: 0 },   // 进水闸
        divert: { cur: 0, tgt: 0 },   // 分流闸（1=全部去灌区，0=全部去蓄水池）
        sluice: { cur: 0, tgt: 0 },   // 泄洪闸
      },
      fields: CFG.fields.map((f) => ({ L: f.l0, done: false, doneAt: 0 })),
      H: CFG.reservoir.h0,
      sensor: {
        age: 0, // 距上次读数更新的时间
        fields: CFG.fields.map((f) => f.l0),
        H: CFG.reservoir.h0,
        qIn: 0,
      },
      flows: { qSource: 0, qIn: 0, qField: 0, qRes: 0, qSluice: 0 },
      surge: { active: false, tEnd: 0, nextAt: 20 + rng() * 15 },
      status: 'playing', // playing | won | lost
      reason: '',
    };
  }

  function setGate(state, name, target) {
    const g = state.gates[name];
    if (g) g.tgt = Math.max(0, Math.min(1, target));
  }

  function moveGate(g, dt) {
    const d = CFG.gateRate * dt;
    if (g.cur < g.tgt) g.cur = Math.min(g.tgt, g.cur + d);
    else g.cur = Math.max(g.tgt, g.cur - d);
  }

  function step(state) {
    if (state.status !== 'playing') return state;
    const dt = CFG.dt;
    state.t += dt;

    // 山洪事件调度
    const sg = state.surge;
    if (!sg.active && state.t >= sg.nextAt) {
      sg.active = true;
      sg.tEnd = state.t + 8 + state.rng() * 6;
    } else if (sg.active && state.t >= sg.tEnd) {
      sg.active = false;
      sg.nextAt = state.t + 25 + state.rng() * 20;
    }

    // 闸门惯性
    moveGate(state.gates.intake, dt);
    moveGate(state.gates.divert, dt);
    moveGate(state.gates.sluice, dt);

    // 流量计算
    const qSource = CFG.sourceBase + (sg.active ? CFG.surgeMag : 0);
    const qIn = qSource * state.gates.intake.cur;
    const qField = qIn * state.gates.divert.cur;
    const qRes = qIn - qField;

    // 农田：串联，第一块未完成的田接收全部灌溉流量
    const k = state.fields.findIndex((f) => !f.done);
    let leftover = 0;
    if (k >= 0) {
      const f = state.fields[k];
      f.L = Math.max(0, f.L + (qField / CFG.fields[k].area - CFG.seep) * dt);
    } else {
      leftover = qField; // 全部完成，余水入蓄水池
    }

    // 蓄水池、泄洪与生态基流
    let qSluice = CFG.sluiceMax * state.gates.sluice.cur * Math.min(1, state.H / 0.3);
    qSluice = Math.max(0, qSluice);
    const qLeak = state.H > 0 ? CFG.leak : 0;
    state.H = Math.max(0, state.H + (qRes + leftover - qSluice - qLeak) / CFG.reservoir.area * dt);

    state.flows = { qSource, qIn, qField, qRes, qSluice, qLeak };

    // 传感器：每 2 秒采样一次，采样时才判定田块完成/溃堤/溢出
    state.sensor.age += dt;
    if (state.sensor.age >= CFG.sensorInterval) {
      state.sensor.age = 0;
      const noisy = (v) => v * (1 + (state.rng() - 0.5) * 0.03);
      state.sensor.fields = state.fields.map((f) => noisy(f.L));
      state.sensor.H = noisy(state.H);
      state.sensor.qIn = qIn;

      for (let i = 0; i < state.fields.length; i++) {
        const f = state.fields[i];
        const c = CFG.fields[i];
        if (f.done) continue;
        if (f.L > c.max) {
          state.status = 'lost';
          state.reason = c.name + '水位超限，田埂冲毁！';
          return state;
        }
        if (f.L >= c.lo && f.L <= c.hi) {
          f.done = true;
          f.doneAt = state.t;
        }
      }
      if (state.H > CFG.reservoir.hMax) {
        state.status = 'lost';
        state.reason = '蓄水池漫顶，下游溢出！';
        return state;
      }
    }

    // 胜负判定
    if (state.fields.every((f) => f.done) && state.H >= CFG.reservoir.hMin) {
      state.status = 'won';
      state.reason = '三块田灌溉完成，蓄水量达标！';
    } else if (state.t >= CFG.timeLimit) {
      state.status = 'lost';
      state.reason = '超出时限，灌溉未完成。';
    }
    return state;
  }

  return { CFG, createState, setGate, step };
});
