/*
 * Aquarium circulation simulator (pure logic, no DOM).
 * Three tanks A (display, fine-sand bed), B (sump / filter / aeration),
 * C (buffer) form a closed ring:
 *   A --V1--> B --pump--> C --V2--> A
 * State per tank: level, salinity, dissolved oxygen, turbidity.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AquariumSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    dt: 1 / 30,
    tanks: ['A 展示缸', 'B 过滤缸', 'C 缓冲缸'],
    ranges: {
      level: [0.30, 0.70],
      salinity: [0.30, 0.40],
      oxygen: [0.60, 0.95],
      turbidity: [0.0, 0.35]
    },
    abnormalCloseSeconds: 25,   // any tank continuously out of range
    sandCloseSeconds: 8,        // fine-sand churn continuously active
    stableHoldSeconds: 30,      // all tanks in range to complete a cycle
    sandPumpThreshold: 0.75,    // pump speed above this lifts fine sand
    pressureAlarm: 1.35,
    surgeAlarm: 0.6,
    levelRate: 0.10,            // level units per second at full imbalance
    mixRate: 0.10,              // fraction exchanged per second at flow 1
    salinityDrift: [0.0022, -0.0028, 0.0016],
    oxygenResp: [0.010, 0.006, 0.008],
    turbiditySettle: 0.012,
    pumpSlew: 0.5,              // actuator physical slew per second
    valveSlew: 0.35
  };

  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createState(seed) {
    return {
      t: 0,
      rng: mulberry32(typeof seed === 'number' ? seed : 20261114),
      pump: 0.35, v1: 0.90, v2: 0.90,
      target: { pump: 0.35, v1: 0.90, v2: 0.90 },
      level: [0.50, 0.50, 0.50],
      salinity: [0.28, 0.38, 0.33],
      oxygen: [0.55, 0.66, 0.58],
      turbidity: [0.18, 0.34, 0.25],
      flow: { ab: 0, bc: 0, ca: 0 },
      pressure: 0.35,
      surge: 0,
      surgeAlarm: 0,
      pressureAlarmOn: false,
      sandChurn: 0,
      sandActive: false,
      sandTimer: 0,
      abnormalTime: [0, 0, 0],
      inRangeHold: 0,
      auto: { pump: 0.35, v1: 0.9, v2: 0.9 },
      status: 'running',
      closeReason: null,
      events: []
    };
  }

  function logEvent(s, type, msg) {
    s.events.push({ t: s.t, type: type, msg: msg });
    if (s.events.length > 120) s.events.shift();
  }

  function applySlew(current, target, maxDelta) {
    if (target > current) return Math.min(target, current + maxDelta);
    if (target < current) return Math.max(target, current - maxDelta);
    return current;
  }

  function inRange(s, i) {
    var r = CONFIG.ranges;
    var L = s.level[i], S = s.salinity[i], O = s.oxygen[i], T = s.turbidity[i];
    return L >= r.level[0] && L <= r.level[1] &&
      S >= r.salinity[0] && S <= r.salinity[1] &&
      O >= r.oxygen[0] && O <= r.oxygen[1] &&
      T >= r.turbidity[0] && T <= r.turbidity[1];
  }

  function step(s, dt) {
    if (s.status !== 'running') return s;
    dt = dt || CONFIG.dt;
    s.t += dt;
    var prevPump = s.pump, prevV1 = s.v1, prevV2 = s.v2;

    // Physical actuators cannot reach a new setting instantly.
    s.pump = applySlew(s.pump, s.target.pump, CONFIG.pumpSlew * dt);
    s.v1 = applySlew(s.v1, s.target.v1, CONFIG.valveSlew * dt);
    s.v2 = applySlew(s.v2, s.target.v2, CONFIG.valveSlew * dt);

    // Ring flows: A->B through V1, B->C through pump, C->A through V2.
    var fbc = s.pump;
    var fab = fbc * s.v1;
    var fca = fbc * s.v2;
    s.flow.ab = fab; s.flow.bc = fbc; s.flow.ca = fca;

    var rates = [fca - fab, fab - fbc, fbc - fca];
    var newLevel = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var L = s.level[i] + CONFIG.levelRate * rates[i] * dt;
      newLevel[i] = clamp(L, 0.05, 0.95);
    }
    s.level = newLevel;

    // Pump discharge pressure and surge from fast actuator moves.
    var pressure = s.pump * (1 + 0.6 * Math.abs(s.v1 - s.v2));
    var surge = (Math.abs(s.pump - prevPump) +
      Math.abs(s.v1 - prevV1) + Math.abs(s.v2 - prevV2)) / dt;
    pressure += 0.35 * Math.min(surge, 3);
    s.surge = surge;
    s.pressure = pressure;
    if (surge > CONFIG.surgeAlarm) {
      s.surgeAlarm = Math.min(1.5, s.surgeAlarm + dt);
      // pressure fluctuations shake settled turbidity into the water
      for (var k = 0; k < 3; k++) {
        s.turbidity[k] = clamp(s.turbidity[k] + 0.04 * dt * Math.min(surge, 3), 0, 1);
      }
      if (s.events.length === 0 || s.t - s.events[s.events.length - 1].t > 2) {
        logEvent(s, 'surge', '压力波动：阀门/泵切换过快');
      }
    } else {
      s.surgeAlarm = Math.max(0, s.surgeAlarm - dt);
    }
    var alarm = pressure > CONFIG.pressureAlarm;
    if (alarm && !s.pressureAlarmOn) logEvent(s, 'pressure', '泵管压力超限');
    s.pressureAlarmOn = alarm;

    transport(s, fab, fbc, fca, dt);
    updateSand(s, dt);
    updateTimers(s, dt);
    return s;
  }

  function transport(s, fab, fbc, fca, dt) {
    var m = CONFIG.mixRate * dt;
    var sal = s.salinity.slice(), oxy = s.oxygen.slice(), tur = s.turbidity.slice();
    // Each tank receives inflow from its upstream neighbour.
    var inflow = [fca, fab, fbc];
    var upstream = [2, 0, 1];
    var arrays = [sal, oxy, tur];
    for (var a = 0; a < arrays.length; a++) {
      var arr = arrays[a];
      for (var i = 0; i < 3; i++) {
        var q = inflow[i];
        arr[i] = arr[i] + m * q * (arr[upstream[i]] - arr[i]);
      }
    }

    // Exogenous drift: each tank has its own slow salinity disturbance.
    for (var j = 0; j < 3; j++) {
      sal[j] = clamp(sal[j] + CONFIG.salinityDrift[j] * dt, 0, 1);
      var aeration = (j === 1 ? 0.11 : 0.03) * (0.4 + 0.6 * fbc);
      oxy[j] = clamp(oxy[j] - CONFIG.oxygenResp[j] * dt + aeration * dt * (1 - oxy[j]), 0, 1);
      tur[j] = Math.max(0, tur[j] - CONFIG.turbiditySettle * dt * (0.5 + 0.5 * fbc));
    }
    s.salinity = sal;
    s.oxygen = oxy;
    s.turbidity = tur;
  }

  function updateSand(s, dt) {
    if (s.pump > CONFIG.sandPumpThreshold) {
      var excess = (s.pump - CONFIG.sandPumpThreshold) / (1 - CONFIG.sandPumpThreshold);
      s.sandChurn = clamp(s.sandChurn + excess * dt * 0.5, 0, 1);
      if (!s.sandActive && s.sandChurn > 0.05) {
        s.sandActive = true;
        logEvent(s, 'sand', '展示缸细砂被翻起，浊度上升');
      }
      // Stirred sand directly clouds the display tank.
      s.turbidity[0] = clamp(s.turbidity[0] + 0.05 * excess * dt, 0, 1);
    } else {
      s.sandChurn = Math.max(0, s.sandChurn - 0.25 * dt);
      if (s.sandChurn <= 0.02) s.sandActive = false;
    }
    if (s.sandActive) s.sandTimer += dt; else s.sandTimer = Math.max(0, s.sandTimer - 2 * dt);
  }

  function updateTimers(s, dt) {
    var allInRange = true;
    for (var i = 0; i < 3; i++) {
      if (inRange(s, i)) {
        s.abnormalTime[i] = Math.max(0, s.abnormalTime[i] - 2 * dt);
      } else {
        s.abnormalTime[i] += dt;
        allInRange = false;
      }
    }
    if (allInRange) {
      s.inRangeHold += dt;
      if (s.inRangeHold >= CONFIG.stableHoldSeconds) {
        s.status = 'stabilized';
        logEvent(s, 'win', '三缸持续达标，稳定循环完成');
        return;
      }
    } else {
      s.inRangeHold = 0;
    }
    if (s.sandTimer >= CONFIG.sandCloseSeconds) {
      s.status = 'closed';
      s.closeReason = 'sand';
      logEvent(s, 'close', '细砂持续翻涌，水族馆闭馆');
      return;
    }
    for (var j = 0; j < 3; j++) {
      if (s.abnormalTime[j] >= CONFIG.abnormalCloseSeconds) {
        s.status = 'closed';
        s.closeReason = 'abnormal:' + j;
        logEvent(s, 'close', CONFIG.tanks[j] + ' 持续异常，水族馆闭馆');
        return;
      }
    }
  }

  // Gentle PI-style autopilot: moderate pump (below sand threshold),
  // valves balanced to bring every water level back to 0.5.
  function autoPilot(s, dt) {
    dt = dt || CONFIG.dt;
    var a = s.auto;
    // Ramp the pump toward a safe, high-mixing operating point.
    var pumpTarget = 0.58;
    a.pump = applySlew(a.pump, pumpTarget, 0.25 * dt);

    var eA = s.level[0] - 0.5;
    var eB = s.level[1] - 0.5;
    var eC = s.level[2] - 0.5;
    var v1Target = clamp(1 + 0.8 * eA - 0.8 * eB, 0.25, 1);
    var v2Target = clamp(1 + 0.8 * eC - 0.8 * eA, 0.25, 1);
    a.v1 = applySlew(a.v1, v1Target, 0.12 * dt);
    a.v2 = applySlew(a.v2, v2Target, 0.12 * dt);
    s.target.pump = a.pump;
    s.target.v1 = a.v1;
    s.target.v2 = a.v2;
  }

  return {
    CONFIG: CONFIG,
    clamp: clamp,
    createState: createState,
    logEvent: logEvent,
    step: step,
    inRange: inRange,
    autoPilot: autoPilot
  };
});
