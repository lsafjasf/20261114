const test = require("node:test");
const assert = require("node:assert/strict");
const sim = require("../js/sim.js");

test("two validation scenarios remain deterministic", () => {
  const first = sim.validateScenarios();
  const second = sim.validateScenarios();
  assert.deepEqual(first, second);
});

test("firefighting adjustment preserves two bins and handles the hotspot", () => {
  const result = sim.validateScenarios().rescue;
  assert.equal(result.passed, true);
  assert.equal(result.status, "won");
  assert.ok(result.safeBins >= 2);
  assert.ok(result.handled >= 1);
});

test("ignored wet zone fails through mold", () => {
  const result = sim.validateScenarios().mold;
  assert.equal(result.passed, true);
  assert.equal(result.status, "lost");
});

test("turner cannot restart while cooling down", () => {
  const state = sim.createSim();
  assert.equal(sim.activateTurner(state, 1), true);
  sim.step(state, 31);
  assert.ok(state.turner.cooldown > 0);
  assert.equal(sim.activateTurner(state, 2), false);
});

test("high fan causes cracking when grain is dry", () => {
  const state = sim.createSim();
  state.controls.fan = 100;
  state.controls.vents = [true, true, true];
  const start = state.bins[0].cracks;
  sim.step(state, 120);
  assert.ok(state.bins[0].cracks > start);
});
