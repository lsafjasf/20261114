(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'));
  else root.PumpPilot = factory(root.PumpSim);
})(typeof self !== 'undefined' ? self : this, function (PumpSim) {
  'use strict';

  const { CFG } = PumpSim;
  const TARGET_LEVEL = 0.5;
  const SLEW = 0.13;

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  class PI {
    constructor(kp, ki, lo, hi) {
      this.kp = kp;
      this.ki = ki;
      this.lo = lo;
      this.hi = hi;
      this.int = 0;
    }
    update(err, dt) {
      const unclamped = this.kp * err + this.ki * this.int;
      const out = clamp(unclamped, this.lo, this.hi);
      if (out === unclamped || (out === this.hi && err < 0) || (out === this.lo && err > 0)) {
        this.int += err * dt;
      }
      this.int = clamp(this.int, -3, 3);
      return out;
    }
  }

  function moveToward(cur, wanted, dt, rate) {
    const maxStep = rate * dt;
    return cur + clamp(wanted - cur, -maxStep, maxStep);
  }

  class PumpPlayer {
    constructor() {
      this.controllers = [
        new PI(2.2, 0.5, 0.12, 0.92),
        new PI(2.2, 0.5, 0.12, 0.92)
      ];
      this.targets = [0.4, 0.4];
    }
    act(sim, dt) {
      sim.pools.forEach((p, i) => {
        let wanted = this.controllers[i].update(p.h - TARGET_LEVEL, dt);
        if (p.h < CFG.CRIT_LOW + 0.06) wanted = Math.min(wanted, 0.1);
        this.targets[i] = clamp(moveToward(this.targets[i], wanted, dt, SLEW), 0.1, 0.94);
        sim.setPump(i, this.targets[i], false);
      });
    }
  }

  class ValvePlayer {
    constructor() {
      this.targets = [0.25, 0.25];
    }
    act(sim, dt) {
      const seep = sim.pools.reduce((s, p) => s + p.qSeep, 0);
      const targetTotalIn = clamp(
        sim.flowTotalDrain * 0.5 + seep * 0.95 + 0.008,
        CFG.FLOW_MIN * 0.7,
        CFG.FLOW_MAX * 0.72
      );
      sim.pools.forEach((p, i) => {
        const recentText = sim.alarms.slice(-4).map((a) => a.text).join(' ');
        let wanted;
        if (new RegExp(p.label + '水位偏高|漫顶').test(recentText)) {
          wanted = 0.08;
        } else if (new RegExp(p.label + '水位偏低').test(recentText)) {
          wanted = 0.55;
        } else {
          const flowPer = targetTotalIn / 2;
          wanted = flowPer / (CFG.K_VALVE * Math.sqrt(Math.max(0.2, p.pSrc)));
        }
        this.targets[i] = clamp(moveToward(this.targets[i], wanted, dt, SLEW), 0.06, 0.7);
        sim.setValve(i, this.targets[i], false);
      });
    }
  }

  return { PumpPlayer, ValvePlayer, PI, TARGET_LEVEL };
});
