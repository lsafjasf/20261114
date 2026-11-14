/* 吊桥物理核心：浏览器游戏与 Node 测试共用。 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.BridgeSim = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULTS = {
    plankCount: 24,        // 桥板数量
    plankLength: 2,        // 每块桥板长度 (m)
    vehicleSpeed: 3.0,     // 车队速度 (m/s)
    neighborK: 320,        // 相邻桥板耦合刚度
    ropeKBase: 10,         // 绳索基础刚度
    ropeKGain: 90,         // 绳索刚度随张力增益
    ropeDamping: 6,        // 绳索阻尼
    neighborDamping: 10,   // 桥板间阻尼
    plankMass: 1,
    loadScale: 1.0,        // 车重(吨) -> 载荷单位
    stressBendCoeff: 1.0,  // 弯曲应力系数
    stressLoadCoeff: 7.0,  // 直接载荷应力系数
    tensionRelief: 0.6,    // 张力对载荷应力的分担比例
    stressLimit: 100,      // 桥板应力上限
    reinforceMult: 2.4,    // 加固后应力上限倍率
    reinforceStiffMult: 1.6,
    reinforceCount: 4,     // 可用加固次数
    vehicleLength: 4.0,    // 车辆载荷覆盖长度 (m)
    collapseBroken: 5,     // 断裂桥板达到此数 -> 垮塌
    abutmentK: 1600,       // 两端桥台的支撑刚度
    dt: 1 / 240,
  };

  const DEFAULT_VEHICLES = [
    { name: '轻型侦察车', mass: 4 },
    { name: '中型运输车', mass: 7 },
    { name: '重型清障车', mass: 10 },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSim(opts) {
    opts = opts || {};
    const cfg = Object.assign({}, DEFAULTS, opts.config || {});
    const n = cfg.plankCount;
    const spacing = opts.spacing != null ? opts.spacing : 22;
    const vehicles = (opts.vehicles || DEFAULT_VEHICLES).map((v, i) => ({
      name: v.name, mass: v.mass, index: i,
      x: -cfg.vehicleLength / 2 - i * spacing,
      state: 'waiting', phase: i * 1.7,
      bump: 0, nextBump: 1 + i * 0.6, loadFactor: 1,
    }));
    return {
      cfg, n,
      bridgeLength: n * cfg.plankLength,
      y: new Float64Array(n),   // 下挠位移，向下为正
      vy: new Float64Array(n),
      load: new Float64Array(n),
      stress: new Float64Array(n),
      broken: new Array(n).fill(false),
      reinforced: new Array(n).fill(false),
      reinforceLeft: cfg.reinforceCount,
      tension: opts.tension != null ? opts.tension : 0.5,
      spacing,
      vehicles,
      time: 0, status: 'setup',
      maxStress: 0, brokenCount: 0,
      rng: mulberry32(opts.seed != null ? opts.seed : 12345),
      events: [],
    };
  }

  function setTension(state, t) {
    state.tension = Math.min(1, Math.max(0, t));
  }

  function toggleReinforce(state, i) {
    if (state.status !== 'setup') return false;
    if (i < 0 || i >= state.n) return false;
    if (state.reinforced[i]) {
      state.reinforced[i] = false;
      state.reinforceLeft++;
      return true;
    }
    if (state.reinforceLeft <= 0) return false;
    state.reinforced[i] = true;
    state.reinforceLeft--;
    return true;
  }

  function start(state) {
    if (state.status !== 'setup') return;
    state.status = 'running';
    state.events.push({ type: 'start', t: state.time });
  }

  function plankLimit(state, i) {
    return state.cfg.stressLimit * (state.reinforced[i] ? state.cfg.reinforceMult : 1);
  }

  function vehicleOnBridge(state, v) {
    const half = state.cfg.vehicleLength / 2;
    return v.x + half > 0 && v.x - half < state.bridgeLength;
  }

  function updateVehicles(state, dt) {
    const cfg = state.cfg;
    for (const v of state.vehicles) {
      if (v.state === 'fallen' || v.state === 'done') continue;
      v.x += cfg.vehicleSpeed * dt;
      if (v.state === 'waiting' && vehicleOnBridge(state, v)) v.state = 'crossing';
      if (v.x - cfg.vehicleLength / 2 > state.bridgeLength) {
        v.state = 'done';
        state.events.push({ type: 'crossed', vehicle: v.name, t: state.time });
        continue;
      }
      v.nextBump -= dt;
      if (v.nextBump <= 0 && vehicleOnBridge(state, v)) {
        v.bump = 0.22 + state.rng() * 0.18;   // 路面颠簸冲击
        v.nextBump = 1.1 + state.rng() * 1.8;
      }
      if (v.bump > 0) v.bump = Math.max(0, v.bump - dt * 0.9);
    }
  }

  function applyVehicleLoads(state) {
    const cfg = state.cfg, n = state.n;
    state.load.fill(0);
    for (const v of state.vehicles) {
      if (v.state === 'fallen' || v.state === 'done') continue;
      if (!vehicleOnBridge(state, v)) continue;
      const bounce = Math.sin(2 * Math.PI * 1.55 * state.time + v.phase);
      const factor = 1 + 0.16 * bounce + v.bump;   // 动态载荷系数
      v.loadFactor = factor;
      const total = v.mass * factor * cfg.loadScale;
      const half = cfg.vehicleLength / 2;
      const i0 = Math.max(0, Math.floor((v.x - half) / cfg.plankLength));
      const i1 = Math.min(n - 1, Math.floor((v.x + half) / cfg.plankLength));
      let wsum = 0;
      const weights = [];
      for (let i = i0; i <= i1; i++) {
        const pc = (i + 0.5) * cfg.plankLength;
        const w = Math.max(0, 1 - Math.abs(pc - v.x) / half);
        weights.push([i, w]);
        wsum += w;
      }
      if (wsum <= 0) continue;
      for (const [i, w] of weights) state.load[i] += total * (w / wsum);
    }
  }

  function integrate(state, dt) {
    const cfg = state.cfg, n = state.n;
    const kRope = cfg.ropeKBase + state.tension * cfg.ropeKGain;
    const damp = cfg.ropeDamping * (0.5 + state.tension) + cfg.neighborDamping;
    for (let i = 0; i < n; i++) {
      if (state.broken[i]) {          // 断裂桥板自由坠落
        state.vy[i] += 9.8 * dt;
        state.y[i] += state.vy[i] * dt;
        continue;
      }
      const yL = i > 0 && !state.broken[i - 1] ? state.y[i - 1] : 0;
      const yR = i < n - 1 && !state.broken[i + 1] ? state.y[i + 1] : 0;
      const stiff = state.reinforced[i] ? cfg.reinforceStiffMult : 1;
      let f = -kRope * stiff * state.y[i];
      if (i === 0 || i === n - 1) f -= cfg.abutmentK * state.y[i];
      f += cfg.neighborK * (yL + yR - 2 * state.y[i]);
      f -= damp * state.vy[i];
      f += state.load[i];
      state.vy[i] += (f / cfg.plankMass) * dt;
    }
    for (let i = 0; i < n; i++) {
      if (!state.broken[i]) state.y[i] += state.vy[i] * dt;
    }
  }

  function computeStress(state) {
    const cfg = state.cfg, n = state.n;
    let maxS = 0;
    for (let i = 0; i < n; i++) {
      if (state.broken[i]) { state.stress[i] = 0; continue; }
      if (i === 0 || i === n - 1) { state.stress[i] = 0; continue; }  // 桥台支撑板
      const yL = i > 0 && !state.broken[i - 1] ? state.y[i - 1] : 0;
      const yR = i < n - 1 && !state.broken[i + 1] ? state.y[i + 1] : 0;
      const bend = Math.abs(cfg.neighborK * (yL + yR - 2 * state.y[i]));
      const relief = 1 - cfg.tensionRelief * state.tension;
      const s = cfg.stressBendCoeff * bend + cfg.stressLoadCoeff * state.load[i] * relief;
      state.stress[i] = s;
      if (s > maxS) maxS = s;
    }
    if (maxS > state.maxStress) state.maxStress = maxS;
    return maxS;
  }

  function checkBreaks(state) {
    for (let i = 0; i < state.n; i++) {
      if (state.broken[i]) continue;
      if (state.stress[i] > plankLimit(state, i)) {
        state.broken[i] = true;
        state.brokenCount++;
        state.vy[i] = 0;
        state.events.push({ type: 'break', plank: i, t: state.time });
      }
    }
    if (state.brokenCount >= state.cfg.collapseBroken && state.status === 'running') {
      state.status = 'lost';
      state.events.push({ type: 'collapse', t: state.time });
    }
  }

  function checkSupport(state) {
    const cfg = state.cfg;
    for (const v of state.vehicles) {
      if (v.state === 'fallen' || v.state === 'done') continue;
      if (!vehicleOnBridge(state, v)) continue;
      const half = cfg.vehicleLength / 2;
      const i0 = Math.max(0, Math.floor((v.x - half * 0.7) / cfg.plankLength));
      const i1 = Math.min(state.n - 1, Math.floor((v.x + half * 0.7) / cfg.plankLength));
      for (let i = i0; i <= i1; i++) {
        if (state.broken[i]) {
          v.state = 'fallen';
          if (state.status === 'running') state.status = 'lost';
          state.events.push({ type: 'vehicle_fell', vehicle: v.name, plank: i, t: state.time });
          break;
        }
      }
    }
  }

  function step(state) {
    if (state.status !== 'running') return;
    const dt = state.cfg.dt;
    state.time += dt;
    updateVehicles(state, dt);
    applyVehicleLoads(state);
    integrate(state, dt);
    computeStress(state);
    checkBreaks(state);
    checkSupport(state);
    if (state.status === 'running' && state.vehicles.every(v => v.state === 'done')) {
      state.status = 'won';
      state.events.push({ type: 'won', t: state.time });
    }
  }

  function simulate(state, maxSeconds) {
    const steps = Math.floor(maxSeconds / state.cfg.dt);
    for (let s = 0; s < steps && state.status === 'running'; s++) step(state);
    return state.status;
  }

  return {
    DEFAULTS,
    createSim,
    setTension,
    toggleReinforce,
    start,
    step,
    simulate,
    plankLimit,
    vehicleOnBridge,
  };
});
