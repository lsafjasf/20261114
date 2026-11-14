// Headless auto-calibration run (Node).
//
// Plays the same game a human would: it only uses the displayed readout
// (attitude error + drift rate), never the hidden true drift. The controller
// low-pass filters the displayed drift rate to reject the periodic wobble,
// integrates that estimate into the bias, and closes a PI loop on attitude
// error so the ball is pulled back to center with zero steady-state offset.
// Over-correction shows up as reverse drift and is removed by the same loop.
//
// Usage: node calibrate.js [seed]

"use strict";

const GyroSim = require("./gyro.js");

function calibrate(seed, verbose) {
  const sim = GyroSim.createSim(seed ? { seed } : {});
  const p = sim.params;
  const dt = 0.02;
  const tau = 2.5;   // low-pass time constant on displayed drift rate, s
  const kp = 0.8;    // proportional gain on attitude error, 1/s
  const ki = 0.15;   // integral gain on attitude error (removes steady-state offset)
  const est = [0, 0, 0];  // filtered residual rate estimate
  const int = [0, 0, 0];  // integrated drift estimate (feed-forward bias)

  let t = 0;
  let nextLog = 5;
  const maxT = 300;

  while (t < maxT) {
    const ro = sim.readout();
    for (let i = 0; i < 3; i++) {
      est[i] += ((ro.rate[i] - est[i]) * dt) / tau;
      int[i] += (est[i] + ki * ro.error[i]) * dt;
      sim.setBias(i, int[i] + kp * ro.error[i]);
    }
    sim.step(dt);
    t += dt;

    if (verbose && t >= nextLog) {
      nextLog += 5;
      const e = ro.error.map((v) => v.toFixed(2).padStart(6)).join(" ");
      const h = ro.hold.toFixed(1);
      console.log("t=" + t.toFixed(0).padStart(3) + "s  error=[" + e + "]  hold=" + h + "s");
    }
    if (sim.state.passed) break;
  }

  const s = sim.state;
  return {
    passed: s.passed,
    passTime: s.passTime,
    finalBias: s.bias.slice(),
    trueDrift: s.drift.slice(),
    finalError: s.error.slice(),
    tol: p.tol,
  };
}

const seed = process.argv[2] ? Number(process.argv[2]) : undefined;
const r = calibrate(seed, true);

console.log("");
if (r.passed) {
  console.log("CALIBRATION PASSED at t=" + r.passTime.toFixed(1) + "s");
} else {
  console.log("CALIBRATION FAILED (time limit reached)");
  process.exitCode = 1;
}
const names = ["X", "Y", "Z"];
console.log("axis  final bias (deg/s)   true drift (deg/s)   final error (deg)");
for (let i = 0; i < 3; i++) {
  console.log(
    " " + names[i] + "      " +
    (r.finalBias[i] >= 0 ? "+" : "") + r.finalBias[i].toFixed(3) +
    "                " +
    (r.trueDrift[i] >= 0 ? "+" : "") + r.trueDrift[i].toFixed(3) +
    "                " +
    (r.finalError[i] >= 0 ? "+" : "") + r.finalError[i].toFixed(3) +
    "  (tol ±" + r.tol + ")"
  );
}
