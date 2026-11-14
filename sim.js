(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PumpSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CFG = {
    DT: 0.05,
    AREA: 2.0,
    K_VALVE: 0.12,
    K_PUMP: 0.19,
    SAFE_LOW: 0.32,
    SAFE_HIGH: 0.68,
    WARN_LOW: 0.25,
    WARN_HIGH: 0.75,
    CRIT_LOW: 0.12,
    OVERFLOW: 1.0,
    RATE_NORMAL: 0.16,
    RATE_FAST: 0.55,
    HAMMER_RATE: 0.34,
    HAMMER_FAST: 0.6,
    FLOOD_WARN: 6,
    FLOOD_CRIT: 10,
    FLOOD_LOSE: 15,
    DAMAGE_LOSE: 100,
    STEADY_TIME: 300,
    FLOW_MIN: 0.09,
    FLOW_MAX: 0.24,
    MAX_ALARMS: 14
  };

  const POOL_NAME = ['A 池', 'B 池'];

  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function seepage(i, t) {
    const base = Math.min(0.03, 0.02 + 0.012 * (t / 900));
    const phase = i * 1.7;
    const ripple = 0.0025 * Math.sin(t * 0.31 + phase) + 0.0015 * Math.sin(t * 0.77 + phase * 2);
    let surge = 0;
    const bumps = i === 0
      ? [[90, 18, 0.034], [260, 20, 0.03], [430, 22, 0.028], [610, 18, 0.026]]
      : [[150, 18, 0.032], [340, 20, 0.031], [520, 22, 0.029], [680, 18, 0.025]];
    for (const [c, w, amp] of bumps) {
      const d = (t - c) / w;
      surge += amp * Math.exp(-d * d);
    }
    return Math.max(0, base + ripple + surge);
  }

  function sourcePressure(i, t) {
    const phase = i * 1.3;
    return 0.72 + 0.22 * Math.sin(0.06 * t + phase) + 0.05 * Math.sin(0.21 * t + phase * 2);
  }

  function createPool(i) {
    return {
      id: i,
      label: POOL_NAME[i],
      h: 0.46 + i * 0.04,
      valve: 0.3,
      valveTarget: 0.3,
      valveFast: false,
      pump: 0.42,
      pumpTarget: 0.42,
      pumpFast: false,
      qIn: 0,
      qDrain: 0,
      qSeep: 0,
      pSrc: 0.8,
      pIn: 0,
      pOut: 0,
      stopTimer: 0,
      hammerFlash: 0,
      inletHammer: 0,
      outletHammer: 0,
      prevQIn: 0,
      prevQDrain: 0
    };
  }

  function createSim() {
    const sim = {
      t: 0,
      status: 'idle',
      endReason: null,
      damageHammer: 0,
      damageCav: 0,
      steady: 0,
      flowTotalIn: 0,
      flowTotalDrain: 0,
      flowShare: [0.5, 0.5],
      alarms: [],
      events: [],
      pools: [createPool(0), createPool(1)],
      stats: { hammerEvents: 0, cavEvents: 0, maxLevel: 0, minLevel: 1 }
    };

    function pushAlarm(sev, text) {
      const last = sim.alarms[sim.alarms.length - 1];
      if (last && last.text === text && sim.t - last.t < 4) return;
      sim.alarms.push({ t: sim.t, sev, text });
      if (sim.alarms.length > CFG.MAX_ALARMS) sim.alarms.shift();
      sim.events.push({ type: 'alarm', sev, text });
    }

    function hammer(pool, side, severe) {
      const dmg = severe ? 30 : 10;
      sim.damageHammer = Math.min(CFG.DAMAGE_LOSE, sim.damageHammer + dmg);
      sim.stats.hammerEvents++;
      pool.hammerFlash = 1;
      if (side === 'in') pool.inletHammer = 1;
      else pool.outletHammer = 1;
      sim.events.push({ type: 'hammer', pool: pool.id, side, severe });
      pushAlarm(severe ? 'crit' : 'warn',
        pool.label + (side === 'in' ? '进水管' : '排水管') + '水锤' + (severe ? '（剧烈）' : ''));
      if (sim.damageHammer >= CFG.DAMAGE_LOSE) {
        sim.status = 'lost';
        sim.endReason = '管道水锤损伤累积到极限，法兰崩裂';
        sim.events.push({ type: 'lose', reason: sim.endReason });
      }
    }

    function setValve(i, target, fast) {
      const p = sim.pools[i];
      p.valveTarget = clamp(target, 0, 1);
      p.valveFast = !!fast;
    }

    function setPump(i, target, fast) {
      const p = sim.pools[i];
      p.pumpTarget = clamp(target, 0, 1);
      p.pumpFast = !!fast;
    }

    function ramp(cur, target, rate, dt) {
      const step = rate * dt;
      if (target > cur + step) return cur + step;
      if (target < cur - step) return cur - step;
      return target;
    }

    sim.setValve = setValve;
    sim.setPump = setPump;

    sim.start = function () { if (sim.status === 'idle') sim.status = 'running'; };

    sim.reset = function () {
      const fresh = createSim();
      Object.keys(sim).forEach((k) => { delete sim[k]; });
      Object.assign(sim, fresh);
    };

    sim.step = function (dt) {
      if (sim.status !== 'running') return;
      dt = dt || CFG.DT;
      sim.t += dt;
      sim.events.length = 0;
      let totIn = 0, totDrain = 0;

      for (const p of sim.pools) {
        p.prevQIn = p.qIn;
        p.prevQDrain = p.qDrain;
        p.valve = ramp(p.valve, p.valveTarget, p.valveFast ? CFG.RATE_FAST : CFG.RATE_NORMAL, dt);
        p.pump = ramp(p.pump, p.pumpTarget, p.pumpFast ? CFG.RATE_FAST : CFG.RATE_NORMAL, dt);

        p.pSrc = sourcePressure(p.id, sim.t);
        p.qSeep = seepage(p.id, sim.t);
        p.qIn = p.valve * CFG.K_VALVE * Math.sqrt(Math.max(0, p.pSrc));
        const canDraw = p.h > 0.001;
        p.qDrain = canDraw ? p.pump * CFG.K_PUMP * Math.sqrt(p.h) : 0;

        const rv = Math.abs(p.valve - (p._prevValve ?? p.valve)) / dt;
        const rp = Math.abs(p.pump - (p._prevPump ?? p.pump)) / dt;
        if (rv > CFG.HAMMER_RATE && p.prevQIn > 0.008) {
          hammer(p, 'in', rv > CFG.HAMMER_FAST || (p._prevValve > 0.4 && p.valve < 0.15));
        }
        if (rp > CFG.HAMMER_RATE && (p.prevQDrain > 0.008 || (p._prevPump < 0.05 && p.pump > 0.25))) {
          hammer(p, 'out', rp > CFG.HAMMER_FAST);
        }
        p._prevValve = p.valve;
        p._prevPump = p.pump;

        p.h = clamp(p.h + (p.qSeep + p.qIn - p.qDrain) * dt / CFG.AREA, 0, CFG.OVERFLOW);
        totIn += p.qIn;
        totDrain += p.qDrain;

        p.pIn = p.pSrc * (0.25 + 0.75 * p.valve) + p.inletHammer * 0.9;
        p.pOut = p.pump * (0.55 + 0.85 * p.h) + p.outletHammer * 1.1;
        p.inletHammer = Math.max(0, p.inletHammer - dt * 1.8);
        p.outletHammer = Math.max(0, p.outletHammer - dt * 1.8);
        p.hammerFlash = Math.max(0, p.hammerFlash - dt * 2.2);
      }
      sim.flowTotalIn = totIn;
      sim.flowTotalDrain = totDrain;
      checkGuards(dt);
      if (sim.status !== 'running') return;
      checkSteady(dt);
    };

    function checkGuards(dt) {
      for (const p of sim.pools) {
        if (p.h >= CFG.OVERFLOW) {
          sim.status = 'lost';
          sim.endReason = p.label + '水位漫顶，泵房被淹';
          sim.events.push({ type: 'lose', reason: sim.endReason });
          return;
        }
        sim.stats.maxLevel = Math.max(sim.stats.maxLevel, p.h);
        sim.stats.minLevel = Math.min(sim.stats.minLevel, p.h);

        if (p.h > CFG.WARN_HIGH) pushAlarm('warn', p.label + '水位偏高');
        if (p.h > CFG.SAFE_HIGH + 0.12) pushAlarm('crit', p.label + '水位逼近漫顶');
        if (p.h < CFG.WARN_LOW) pushAlarm('warn', p.label + '水位偏低');

        if (p.pump < 0.05) p.stopTimer += dt;
        else p.stopTimer = Math.max(0, p.stopTimer - dt * 2);
        if (p.stopTimer > CFG.FLOOD_WARN) pushAlarm('warn', p.label + '排水中断，平台积水');
        if (p.stopTimer > CFG.FLOOD_CRIT) pushAlarm('crit', p.label + '平台即将淹没');
        if (p.stopTimer > CFG.FLOOD_LOSE) {
          sim.status = 'lost';
          sim.endReason = p.label + '排水中断超时，平台淹没';
          sim.events.push({ type: 'lose', reason: sim.endReason });
          return;
        }

        if (p.h < CFG.CRIT_LOW && p.pump > 0.1) {
          const rate = p.h <= 0.001 ? 22 : 7;
          sim.damageCav = Math.min(CFG.DAMAGE_LOSE, sim.damageCav + rate * dt);
          sim.stats.cavEvents++;
          pushAlarm('crit', p.label + '泵气蚀风险');
          if (sim.damageCav >= CFG.DAMAGE_LOSE) {
            sim.status = 'lost';
            sim.endReason = p.label + '排水泵气蚀损毁';
            sim.events.push({ type: 'lose', reason: sim.endReason });
            return;
          }
        }
      }
      if (sim.flowTotalDrain < CFG.FLOW_MIN) pushAlarm('warn', '总排水流量低于调度下限');
      if (sim.flowTotalDrain > CFG.FLOW_MAX) pushAlarm('warn', '总排水流量超过管网上限');
    }

    function checkSteady(dt) {
      const okLevel = sim.pools.every((p) => p.h >= CFG.SAFE_LOW && p.h <= CFG.SAFE_HIGH);
      const okFlow = sim.flowTotalDrain >= CFG.FLOW_MIN && sim.flowTotalDrain <= CFG.FLOW_MAX;
      const okRunning = sim.pools.every((p) => p.pump > 0.08);
      const hammerNow = sim.damageHammer > (sim._lastHammerDamage ?? sim.damageHammer);
      sim._lastHammerDamage = sim.damageHammer;
      if (okLevel && okFlow && okRunning && !hammerNow) {
        sim.steady += dt;
        if (sim.steady >= CFG.STEADY_TIME) {
          sim.status = 'won';
          sim.events.push({ type: 'win' });
        }
      } else {
        sim.steady = 0;
      }
    }

    return sim;
  }

  return { createSim, CFG, seepage, sourcePressure };
});
