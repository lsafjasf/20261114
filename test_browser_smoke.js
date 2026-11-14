// Headless smoke test: stubs just enough DOM to execute the real
// game.js + render.js frame loop, then flies a full mission on autopilot.
const fs = require("fs");
const path = require("path");

const rafQueue = [];
const listeners = {};

function makeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, prop) {
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => grad;
      if (prop === "measureText") return () => ({ width: 0 });
      if (typeof t[prop] !== "undefined") return t[prop];
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

function makeInput(value) {
  return { value: String(value), addEventListener() {} };
}

const coilCtls = [0, 1, 2, 3].map((i) => ({
  dataset: { coil: String(i) },
  querySelector(sel) {
    if (sel === "input") return makeInput([0.25, 0.25, 0.9, 0.08][i]);
    return { textContent: "" };
  },
}));

global.window = global;
global.self = global;
global.performance = { now: () => simNow };
global.requestAnimationFrame = (cb) => rafQueue.push(cb);
global.document = {
  getElementById(id) {
    if (id === "cv") return { getContext: () => makeCtx(), width: 960, height: 600 };
    return { addEventListener() {}, classList: { toggle() {} } };
  },
  querySelectorAll: () => coilCtls,
};
global.addEventListener = (type, cb) => { (listeners[type] = listeners[type] || []).push(cb); };

let simNow = 0;
const load = (f) => eval(fs.readFileSync(path.join(__dirname, f), "utf8"));
global.Physics = require("./physics.js");
global.Autopilot = require("./autopilot.js");
load("render.js");
load("game.js");

// turn on autopilot via the "p" key handler
listeners.keydown.forEach((cb) => cb({ key: "p", preventDefault() {} }));

let frames = 0;
const maxFrames = 120 * 90; // 90 simulated seconds
while (rafQueue.length && frames < maxFrames) {
  const cb = rafQueue.shift();
  simNow += 1000 / 60;
  cb(simNow);
  frames++;
}
console.log(`smoke: ran ${frames} frames without exceptions`);
console.log("SMOKE OK");
