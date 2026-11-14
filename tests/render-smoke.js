/* Smoke test: exercise the full Canvas draw path with a stub 2D context,
 * so rendering regressions are caught without a browser. */
'use strict';
const assert = require('assert');
const Sim = require('../js/sim.js');
global.AquariumSim = Sim;
const R = require('../js/render.js');

const calls = [];
const gradient = { addColorStop: () => {} };
const ctx = new Proxy({}, {
  get: (t, prop) => {
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
    if (prop === 'measureText') return () => ({ width: 10 });
    return (...args) => { calls.push([prop, ...args]); };
  },
  set: () => true
});

const s = Sim.createState();
R.drawScene(ctx, s, 980, 580);
assert(calls.some(c => c[0] === 'fillRect'), 'background should be painted');
assert(calls.some(c => c[0] === 'arc'), 'tanks/particles should draw arcs');

// drive into sand-churn / alarm states
s.target.pump = 1;
for (let i = 0; i < 30 * 6; i++) { s.target.pump = 1; Sim.step(s); }
assert(s.sandActive === true, 'sand should be active after sustained max pump');
R.drawScene(ctx, s, 980, 580);

// closed overlay path
for (let i = 0; i < 30 * 6 && s.status === 'running'; i++) { s.target.pump = 1; Sim.step(s); }
assert(s.status === 'closed' && s.closeReason === 'sand', 'should close on sand');
R.drawScene(ctx, s, 980, 580);

// stabilized overlay path
const win = Sim.createState(3);
for (let i = 0; i < 30 * 120 && win.status === 'running'; i++) { Sim.autoPilot(win); Sim.step(win); }
assert(win.status === 'stabilized', 'autopilot should stabilize');
R.drawScene(ctx, win, 980, 580);

console.log('PASS  render smoke: ' + calls.length + ' canvas calls across running/churn/closed/stabilized states');
