// Node smoke test for app.js: stubs just enough DOM/Canvas to execute the
// main loop a few frames and catch runtime errors (typos, undefined vars).
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function anything() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(target, prop) {
      if (prop === "canvas") return { width: 520, height: 520 };
      if (prop === "length") return 0;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
  });
  return proxy;
}

const el = anything();
let frames = 0;

const sandbox = {
  console,
  GyroSim: require("./gyro.js"),
  document: {
    getElementById: () => el,
    createElement: () => el,
  },
  window: { addEventListener: () => {} },
  performance: { now: () => frames * 16.7 },
  requestAnimationFrame: (cb) => {
    if (frames++ < 10) cb(frames * 16.7);
  },
  location: { reload: () => {} },
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
vm.runInContext(src, sandbox, { filename: "app.js" });
console.log("app.js smoke test ok (" + frames + " frames)");
