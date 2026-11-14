import test from 'node:test';
import assert from 'node:assert/strict';
import { RailSim } from '../src/sim.js';

function playPerfectRun() {
  const sim = new RailSim({ autoStart: true });
  assert.equal(sim.setSwitch('NE', 'cross').ok, true);
  assert.equal(sim.setSwitch('SE', 'cross').ok, true);
  let flippedNW = false;
  let flippedSE = false;
  const limit = 120 * 20;
  for (let i = 0; i < limit && !sim.result; i += 1) {
    sim.advance(0.05);
    const state = sim.getState();
    const blue = state.trains.find((train) => train.id === 'blue');
    if (!flippedNW && blue.p > 0.29) {
      assert.equal(sim.setSwitch('NW', 'cross').ok, true);
      flippedNW = true;
    }
    if (!flippedSE && blue.p > 0.8) {
      assert.equal(sim.setSwitch('SE', 'straight').ok, true);
      flippedSE = true;
    }
  }
  return sim;
}

test('a full dispatch run completes both trains with three stations each', () => {
  const sim = playPerfectRun();
  const state = sim.getState();
  assert.equal(state.result, 'win', JSON.stringify(state.failure));
  for (const train of state.trains) {
    assert.equal(train.done, true);
    assert.equal(train.stationCount, 3);
    assert.equal(train.wear, 0);
    assert.equal(train.emergencyStops, 0);
    assert.equal(train.derailed, false);
  }
  assert.ok(state.trains[0].finishedAt < state.trains[1].finishedAt);
});

test('setting a turnout against the route triggers an emergency stop and wear', () => {
  const sim = new RailSim({ autoStart: true });
  assert.equal(sim.setSwitch('NW', 'cross').ok, true);
  let blue = null;
  for (let i = 0; i < 400 && !blue; i += 1) {
    sim.advance(0.05);
    const state = sim.getState();
    const candidate = state.trains.find((train) => train.id === 'blue');
    if (candidate.status === 'held') blue = candidate;
  }
  assert.ok(blue, 'blue train should be held at the NW home signal');
  assert.equal(blue.hold.type, 'signal');
  assert.equal(blue.hold.junction, 'NW');
  assert.equal(blue.wear, 18);
  assert.equal(blue.emergencyStops, 1);
  assert.ok(blue.p < 0.22 && blue.p > 0.19);
  assert.ok(sim.getState().events.some((event) => event.type === 'signal-stop'));

  assert.equal(sim.setSwitch('NW', 'straight').ok, true);
  for (let i = 0; i < 60; i += 1) sim.advance(0.05);
  const resumed = sim.getState().trains.find((train) => train.id === 'blue');
  assert.notEqual(resumed.status, 'held');
  assert.ok(resumed.p > blue.p);
  assert.ok(sim.getState().events.some((event) => event.type === 'signal-clear'));
});

test('a turnout cannot be thrown while its interlocking zone is occupied', () => {
  const sim = new RailSim({ autoStart: true });
  let lockedState = null;
  for (let i = 0; i < 400 && !lockedState; i += 1) {
    sim.advance(0.05);
    const state = sim.getState();
    if (state.switches.find((item) => item.id === 'NW').occupied) lockedState = state;
  }
  assert.ok(lockedState, 'NW should become occupied as blue passes');
  const result = sim.setSwitch('NW', 'cross');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'occupied');
  assert.equal(sim.getSwitchState('NW'), 'straight');
  assert.ok(sim.getState().events.some((event) => event.type === 'lock'));
});

test('pause freezes the clock and the trains until resumed', () => {
  const sim = new RailSim({ autoStart: true });
  sim.advance(1);
  const before = sim.getState();
  sim.pause();
  sim.advance(5);
  const paused = sim.getState();
  assert.equal(paused.elapsed, before.elapsed);
  assert.equal(paused.trains[0].p, before.trains[0].p);
  sim.resume();
  sim.advance(1);
  assert.ok(sim.getState().elapsed > paused.elapsed);
});
