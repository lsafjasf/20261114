const assert = require("node:assert/strict");
const { Simulation, IceWorld, constants, utilities } = require("../js/sim.js");

const DT = 1 / 60;
const SEED = 20261114;
const { distance, normalizeAngle } = utilities;

function worldChecksum(world) {
  let value = 2166136261;
  for (let index = 0; index < world.thickness.length; index += 1) {
    value ^= Math.round(world.thickness[index] * 1000);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function setSteering(input, difference) {
  input.left = difference < -0.045;
  input.right = difference > 0.045;
}

function driveRoute(sim, route, options = {}) {
  const points = route.map((point) => ({ x: point.x, y: point.y }));
  let cursor = 0;
  let steps = 0;
  let arrivedSteps = 0;
  const maxSteps = options.maxSteps || 60 * 150;
  const target = points[points.length - 1];
  while (steps < maxSteps && sim.status === "playing") {
    const vehicle = sim.vehicle;
    while (cursor < points.length - 1 && distance(vehicle, points[cursor]) < 42) cursor += 1;
    const waypoint = points[cursor];
    const gap = distance(vehicle, target);
    if (gap < 24) {
      arrivedSteps += 1;
    } else {
      arrivedSteps = 0;
    }
    const desired = Math.atan2(waypoint.y - vehicle.y, waypoint.x - vehicle.x);
    const difference = normalizeAngle(desired - vehicle.angle);
    const differenceNow = Math.abs(difference);
    const speed = Math.abs(vehicle.speed);
    const cruise = gap < 58 ? 22 : gap < 120 ? 58 : differenceNow > 0.6 ? 58 : differenceNow > 0.25 ? 118 : 172;
    const input = {
      up: speed < cruise,
      down: speed > cruise + 10 || (differenceNow > 0.7 && speed > 55),
      left: false,
      right: false,
    };
    setSteering(input, difference);
    if (gap < 32 && speed < 8) {
      input.up = false;
      input.down = false;
    }
    sim.update(DT, input);
    steps += 1;
    if (arrivedSteps >= 40) break;
    if (options.onStep) options.onStep(sim, { cursor, gap, step: steps });
  }
  assert.ok(
    sim.status === "playing" || (options.allowWin && sim.status === "won"),
    `route drive failed: ${sim.status}/${sim.endReason}`,
  );
  if (sim.status === "playing") {
    assert.ok(distance(sim.vehicle, target) < 42, `failed to reach route end (${distance(sim.vehicle, target).toFixed(1)}px)`);
  }
  if (sim.status === "playing") {
    for (let index = 0; index < 70 && Math.abs(sim.vehicle.speed) > 1.2; index += 1) {
      sim.update(DT, { down: sim.vehicle.speed > 0, up: sim.vehicle.speed < -1 });
    }
    assert.ok(Math.abs(sim.vehicle.speed) < 4, "vehicle did not stop at sample site");
  }
  return { steps, time: sim.time };
}

function collectAtCore(sim, core) {
  assert.ok(distance(sim.vehicle, core) < 84, "vehicle is not close enough to sample");
  const before = sim.vehicle.load;
  let steps = 0;
  while (sim.status === "playing" && sim.vehicle.load === before && steps < 180) {
    sim.update(DT, { sample: true });
    steps += 1;
  }
  assert.equal(sim.status, "playing", `sampling failed: ${sim.endReason}`);
  assert.equal(sim.vehicle.load, before + 1, "sample was not loaded");
  return { steps, core: core.name };
}

function driveAndSample(sim, route, core, options) {
  const outbound = driveRoute(sim, route, options);
  const sampled = collectAtCore(sim, core);
  return { outbound, sampled };
}

function runMission({ discardInTransit = false, label }) {
  const sim = new Simulation({ seed: SEED });
  sim.start();
  const routeLog = [];
  for (let index = 0; index < sim.world.cores.length; index += 1) {
    const core = sim.world.cores[index];
    const route = sim.world.routes[index];
    const outbound = driveAndSample(sim, route, core);
    routeLog.push(Math.round(sim.world.pathLength(route)));
    assert.equal(sim.coresCollected, index + 1, "core count mismatch after sampling");
    if (index === sim.world.cores.length - 1) continue;
    const home = route.slice().reverse();
    driveRoute(sim, home);
    assert.equal(sim.status, "playing", "mission should not end before all three cores");
  }

  const returnRoute = sim.world.routes[2].slice().reverse();
  let discardedAt = null;
  driveRoute(sim, returnRoute, {
    allowWin: true,
    onStep(instance) {
      if (!discardInTransit || discardedAt !== null) return;
      const campGap = distance(instance.vehicle, instance.world.camp);
      if (campGap < 460) {
        instance.update(DT, { discard: true });
        discardedAt = {
          x: Math.round(instance.vehicle.x),
          y: Math.round(instance.vehicle.y),
          load: instance.vehicle.load,
        };
      }
    },
  });

  if (discardInTransit) {
    assert.ok(discardedAt, "discard action was never triggered");
    assert.equal(discardedAt.load, 2, "discard did not reduce load to two cores");
  }
  assert.equal(sim.status, "won", `mission did not complete: ${sim.status}/${sim.endReason}`);
  const summary = sim.getSummary();
  assert.equal(summary.routeVerified, true, "map contains an invalid camp route");
  assert.equal(summary.collected, 3, "all three sample sites must be collected");
  assert.equal(summary.delivered, discardInTransit ? 2 : 3, "delivered cores mismatch");
  assert.equal(summary.discarded, discardInTransit ? 1 : 0, "discarded cores mismatch");
  assert.equal(summary.ending, discardInTransit ? "evacuated" : "complete");
  assert.ok(summary.oxygen > 0, "oxygen should remain");
  assert.ok(summary.hull > 0, "hull should remain intact");
  return {
    label,
    status: summary.status,
    ending: summary.ending,
    delivered: summary.delivered,
    discarded: summary.discarded,
    mass: Math.round(summary.mass),
    oxygen: Math.round(summary.oxygen),
    hull: Math.round(summary.hull),
    time: Number(summary.time.toFixed(1)),
    distance: Math.round(summary.distance),
    topSpeed: summary.topSpeed,
    cracks: summary.cracks,
    routes: routeLog,
    discardedAt,
  };
}

function verifyDeterminism() {
  const first = new IceWorld(SEED);
  const second = new IceWorld(SEED);
  assert.equal(worldChecksum(first), worldChecksum(second), "same seed generated different ice");
  assert.deepEqual(
    first.cores.map((core) => [Math.round(core.x), Math.round(core.y)]),
    second.cores.map((core) => [Math.round(core.x), Math.round(core.y)]),
    "same seed generated different sample sites",
  );
  assert.equal(first.routeViability.every(Boolean), true);
  for (const route of first.routes) {
    assert.equal(first.isRouteViable(route), true, "camp route is not viable");
  }
  return { checksum: worldChecksum(first), routes: first.routes.map((route) => Math.round(first.pathLength(route))) };
}

function damageProbe(load, speed) {
  const sim = new Simulation({ seed: SEED });
  sim.start();
  sim.world.thickness.fill(0.34);
  sim.world.water.fill(0);
  sim.vehicle.x = 1200;
  sim.vehicle.y = 800;
  sim.vehicle.angle = 0;
  sim.vehicle.load = load;
  sim.vehicle.mass = sim.mass;
  for (let step = 0; step < 60 * 6; step += 1) {
    sim.vehicle.speed = speed;
    sim.update(DT, {});
  }
  assert.equal(sim.status, "playing");
  return sim.damageTaken;
}

function verifyLoadAndSpeedDamage() {
  const light = damageProbe(0, 215);
  const heavy = damageProbe(3, 215);
  const slow = damageProbe(3, 70);
  const fast = damageProbe(3, 215);
  assert.ok(heavy > light * 1.25, "load must amplify ice stress");
  assert.ok(fast > slow * 1.8, "speed must amplify ice stress");
  return {
    lightHullDamage: Number(light.toFixed(2)),
    heavyHullDamage: Number(heavy.toFixed(2)),
    slowHullDamage: Number(slow.toFixed(2)),
    fastHullDamage: Number(fast.toFixed(2)),
  };
}

console.log("ICE CORE SURVEY // automated field verification");
const world = verifyDeterminism();
console.log(`fixed map  seed=${SEED}  checksum=${world.checksum}  routes=${world.routes.join("/")}px`);
const stress = verifyLoadAndSpeedDamage();
console.log(`stress probe  light=${stress.lightHullDamage}  heavy=${stress.heavyHullDamage}  slow=${stress.slowHullDamage}  fast=${stress.fastHullDamage}`);

const fullReturn = runMission({ discardInTransit: false, label: "带样返航" });
console.log(JSON.stringify(fullReturn, null, 2));

const reducedReturn = runMission({ discardInTransit: true, label: "弃样减重" });
console.log(JSON.stringify(reducedReturn, null, 2));

assert.equal(fullReturn.delivered, 3);
assert.equal(reducedReturn.delivered, 2);
assert.ok(reducedReturn.mass < fullReturn.mass, "discarding must reduce vehicle mass");
assert.ok(reducedReturn.cracks <= fullReturn.cracks + 20, "crack generation should remain bounded");

console.log("PASS: 3/3 cores delivered with all terrain routes intact");
console.log("PASS: one core discarded in transit; 2/3 delivered at reduced mass");
console.log("PASS: speed and cargo load both increase measured hull stress");
