// Node test rig: runs the shared physics headlessly.
//  1. autopilot completes 3 rings + safe landing
//  2. current lag matches the configured time constant
//  3. uncontrolled ball under disturbance goes unstable / crashes
const Physics = require("./physics.js");
const Autopilot = require("./autopilot.js");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(name, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`[${tag}] ${name}${detail ? "  -- " + detail : ""}`);
}

// ---- Test 1: full mission under autopilot -------------------------------
function missionTest(seed) {
  const s = Physics.createState(mulberry32(seed));
  const dt = 1 / 120;
  let maxSpeed = 0;
  while (s.phase !== "success" && s.phase !== "crashed" && s.t < 120) {
    Autopilot.control(s);
    Physics.step(s, dt);
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.vx, s.vy));
  }
  return { s, maxSpeed };
}

console.log("== Mission test: 3 rings + safe landing (autopilot, 5 seeds) ==");
for (const seed of [11, 22, 33, 44, 55]) {
  const { s } = missionTest(seed);
  const rings = s.ringDone.filter(Boolean).length;
  check(`seed ${seed}: mission success`, s.phase === "success",
    `phase=${s.phase} rings=${rings}/3 touches=${s.touches} score=${s.score} ` +
    `t=${s.t.toFixed(1)}s landV=${s.landV.toFixed(1)}px/s`);
}

// ---- Test 2: current lag -------------------------------------------------
console.log("== Current-lag test ==");
{
  const s = Physics.createState(mulberry32(7));
  s.currents = [0, 0, 0, 0];
  s.targets = [0, 0, 0, 0];
  s.targets[2] = 1.0;
  const dt = 1 / 240;
  let tTau = null;
  for (let t = 0; t < 2; t += dt) {
    Physics.step(s, dt);
    if (tTau === null && s.currents[2] >= 0.632) tTau = s.t;
  }
  const err = Math.abs(tTau - Physics.CFG.lagTau);
  check("current reaches 63.2% near tau", err < 0.05,
    `reached at t=${tTau && tTau.toFixed(3)}s (tau=${Physics.CFG.lagTau}s)`);
}

// ---- Test 3: instability without control --------------------------------
console.log("== Instability test: fixed currents + disturbance, no control ==");
{
  const s = Physics.createState(mulberry32(99));
  // fixed hover-ish currents, no feedback
  s.targets = [0.35, 0.35, 1.1, 0.1];
  const dt = 1 / 120;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  while (s.phase !== "crashed" && s.t < 30) {
    Physics.step(s, dt);
    minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
  }
  const drift = Math.max(maxX - minX, maxY - minY);
  const lost = s.phase === "crashed" || s.unstable || drift > 300;
  check("uncontrolled ball loses stability", lost,
    `phase=${s.phase} unstable=${s.unstable} drift=${drift.toFixed(0)}px t=${s.t.toFixed(1)}s`);
}

// ---- Test 4: ring graze lowers the score ---------------------------------
console.log("== Ring-graze scoring test ==");
{
  const s = Physics.createState(mulberry32(5));
  const r = Physics.CFG.rings[0];
  s.x = r.x; s.y = r.y - Physics.CFG.ringIn - 2; // inside the ring band
  s.vx = 30;
  Physics.step(s, 1 / 120);
  check("grazing the ring band costs score", s.touches === 1 && s.score < 100,
    `touches=${s.touches} score=${s.score}`);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
