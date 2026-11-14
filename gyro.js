// Gyro drift calibration simulation core.
// Shared by the browser UI (app.js) and the headless auto-calibrator (calibrate.js).
//
// The player never sees the true drift; they only see the attitude error
// (attitude ball) and the current drift rate (error velocity). Adjusting the
// per-axis bias subtracts from the true drift. Over-correcting flips the sign
// of the residual rate, producing reverse drift. A slow periodic external
// wobble is superimposed on the rates.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GyroSim = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    tol: 1.5,              // per-axis error tolerance, degrees
    holdTime: 10,          // seconds inside tolerance required to pass
    drift0: [0.62, -0.47, 0.35],   // initial true drift rate, deg/s
    error0: [4.2, -3.1, 2.6],      // initial attitude error, degrees
    driftDiffusion: 0.012, // random walk of true drift, deg/s per sqrt(s)
    driftMax: 1.2,         // clamp on true drift magnitude, deg/s
    wobbleAmp: [0.16, 0.12, 0.09], // external wobble rate amplitude, deg/s
    wobbleFreq: 0.18,      // external wobble frequency, Hz
    wobblePhase: [0.0, 2.1, 4.2],
    biasStep: 0.02,        // UI nudge size, deg/s
    biasMax: 2.0,          // clamp on player bias, deg/s
    seed: 20261114,
  };

  // Deterministic PRNG (mulberry32) so runs are reproducible.
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSim(options) {
    const p = Object.assign({}, DEFAULTS, options || {});
    const rng = makeRng(p.seed);

    const state = {
      t: 0,
      drift: p.drift0.slice(),   // hidden true drift rate, deg/s
      error: p.error0.slice(),   // attitude error vs target, degrees
      bias: [0, 0, 0],           // player correction, deg/s
      rate: [0, 0, 0],           // current error velocity, deg/s (displayed)
      wobble: [0, 0, 0],         // current wobble rate contribution
      hold: 0,                   // consecutive seconds inside tolerance
      inside: false,
      passed: false,
      passTime: 0,
    };

    function gauss() {
      // Box-Muller
      const u1 = Math.max(rng(), 1e-12);
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }

    function step(dt) {
      state.t += dt;
      const wOmega = 2 * Math.PI * p.wobbleFreq;
      let allInside = true;
      for (let i = 0; i < 3; i++) {
        // True drift slowly wanders.
        state.drift[i] += gauss() * p.driftDiffusion * Math.sqrt(dt);
        state.drift[i] = Math.max(-p.driftMax, Math.min(p.driftMax, state.drift[i]));
        // Periodic external wobble adds a rate disturbance.
        state.wobble[i] =
          p.wobbleAmp[i] * Math.sin(wOmega * state.t + p.wobblePhase[i]);
        // Residual rate = true drift - player bias + wobble.
        state.rate[i] = state.drift[i] - state.bias[i] + state.wobble[i];
        state.error[i] += state.rate[i] * dt;
        if (Math.abs(state.error[i]) > p.tol) allInside = false;
      }
      state.inside = allInside;
      if (allInside) {
        state.hold += dt;
      } else {
        state.hold = 0;
      }
      if (!state.passed && state.hold >= p.holdTime) {
        state.passed = true;
        state.passTime = state.t;
      }
      return state;
    }

    function nudgeBias(axis, direction, scale) {
      const k = typeof scale === "number" ? scale : 1;
      state.bias[axis] += direction * p.biasStep * k;
      state.bias[axis] = Math.max(-p.biasMax, Math.min(p.biasMax, state.bias[axis]));
      return state.bias[axis];
    }

    function setBias(axis, value) {
      state.bias[axis] = Math.max(-p.biasMax, Math.min(p.biasMax, value));
      return state.bias[axis];
    }

    // What the UI is allowed to show: attitude error and drift rate only.
    function readout() {
      return {
        t: state.t,
        error: state.error.slice(),
        rate: state.rate.slice(),
        inside: state.inside,
        hold: state.hold,
        passed: state.passed,
      };
    }

    return {
      params: p,
      state,
      step,
      nudgeBias,
      setBias,
      readout,
    };
  }

  return { createSim, DEFAULTS };
});
