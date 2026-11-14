import assert from "node:assert/strict";
import test from "node:test";
import { runAutopilot } from "../scripts/autopilot.js";
import { cargoLightness, createGame, stepGame } from "../src/simulation.js";
import { generateWorld, northPassageOpen, verifyRoutes } from "../src/world.js";

test("seed generation is deterministic", () => {
  const first = generateWorld("survey-07");
  const second = generateWorld("survey-07");
  assert.deepEqual(first, second);
  const other = generateWorld("survey-08");
  assert.notDeepEqual(
    first.shoals.map((shoal) => [shoal.x.toFixed(2), shoal.y.toFixed(2)]),
    other.shoals.map((shoal) => [shoal.x.toFixed(2), shoal.y.toFixed(2)])
  );
});

test("all three zones have a navigable low-tide waterway", () => {
  const world = generateWorld(20261114);
  const audit = verifyRoutes(world, 0.16);
  assert.equal(audit.allReachable, true);
  assert.equal(audit.passageOpen, true);
});

test("flood tide closes the north shoal passage but keeps B and C reachable", () => {
  const world = generateWorld(20261114);
  const flood = verifyRoutes(world, 0.88);
  assert.equal(flood.passageOpen, false);
  assert.equal(flood.routes.find((route) => route.id === "A").reachable, false);
  assert.equal(flood.routes.find((route) => route.id === "B").reachable, true);
  assert.equal(flood.routes.find((route) => route.id === "C").reachable, true);
  assert.equal(northPassageOpen(world, 0.16), true);
  assert.equal(northPassageOpen(world, 0.88), false);
});

test("low/flood route topology holds across seeded charts", () => {
  for (let index = 0; index < 24; index += 1) {
    const world = generateWorld(index * 7919 + 13);
    const low = verifyRoutes(world, 0.16);
    const flood = verifyRoutes(world, 0.88);
    assert.equal(low.allReachable, true, `low tide failed for seed ${world.seed}`);
    assert.equal(flood.routes.find((route) => route.id === "A").reachable, false, `A stayed open at high tide for ${world.seed}`);
    assert.equal(flood.routes.find((route) => route.id === "B").reachable, true, `B closed for ${world.seed}`);
    assert.equal(flood.routes.find((route) => route.id === "C").reachable, true, `C closed for ${world.seed}`);
  }
});

test("a complete three-zone deployment finishes before backflow", () => {
  const run = runAutopilot(20261114);
  assert.equal(run.error, null);
  assert.equal(run.game.phase, "win");
  assert.equal(run.game.boat.deployed, 3);
  assert.equal(run.game.boat.cargo, 0);
  assert.ok(run.game.elapsed < 90, `deployment took ${run.game.elapsed.toFixed(1)}s`);
});

test("dropping cargo reduces mass and makes steering more responsive", () => {
  const loaded = createGame(20261114);
  const light = createGame(20261114);
  light.boat.cargo = 0;
  for (let index = 0; index < 40; index += 1) {
    stepGame(loaded, 0.02, { throttle: 0.8, steer: 0.7 });
    stepGame(light, 0.02, { throttle: 0.8, steer: 0.7 });
  }
  const loadedSpeed = Math.hypot(loaded.boat.vx, loaded.boat.vy);
  const lightSpeed = Math.hypot(light.boat.vx, light.boat.vy);
  assert.ok(cargoLightness(light) > cargoLightness(loaded));
  assert.ok(lightSpeed > loadedSpeed);
  assert.ok(Math.abs(light.boat.angularVelocity) > Math.abs(loaded.boat.angularVelocity));
});
