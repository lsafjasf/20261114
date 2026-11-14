import test from "node:test";
import assert from "node:assert/strict";
import {
  BOAT,
  PASSENGERS,
  WORLD,
  boardPassengers,
  countPassengers,
  createPassengers,
  deliverPassengers,
  generateWorld,
  getHandling,
  getObjective,
  isMainChannelClear,
} from "../src/model.js";

test("the same seed builds the same river, different seeds move the markers", () => {
  const first = generateWorld("lantern-17");
  const repeat = generateWorld("lantern-17");
  const other = generateWorld("lantern-18");

  assert.deepEqual(first, repeat);
  assert.notDeepEqual(
    first.beacons.map(({ x, y }) => [x, y]),
    other.beacons.map(({ x, y }) => [x, y]),
  );
  assert.notDeepEqual(
    first.driftwood.map(({ x, y }) => [x, y]),
    other.driftwood.map(({ x, y }) => [x, y]),
  );
});

test("every generated driftwood stays outside the safe shipping channel", () => {
  for (let seed = 0; seed < 300; seed += 1) {
    const world = generateWorld(`seed-${seed}`);
    assert.equal(isMainChannelClear(world), true, `seed-${seed}`);
    assert.ok(world.driftwood.length >= 7, `seed-${seed} produced too little hazard`);
    for (const beacon of world.beacons) {
      assert.ok(beacon.x >= 0 && beacon.x <= WORLD.width);
    }
  }
});

test("passengers make the ferry slower and more fragile", () => {
  const empty = getHandling(0);
  const half = getHandling(1);
  const full = getHandling(3);

  assert.equal(full.load, WORLD.capacity);
  assert.ok(full.mass > half.mass && half.mass > empty.mass);
  assert.ok(full.acceleration < half.acceleration);
  assert.ok(full.maxSpeed < empty.maxSpeed);
  assert.ok(full.collisionDamage > empty.collisionDamage * 1.5);
  assert.ok(full.acceleration < BOAT.baseAcceleration);
  assert.ok(full.maxSpeed < BOAT.baseMaxSpeed);
});

test("load beyond the rated capacity applies an additional overload penalty", () => {
  const full = getHandling(WORLD.capacity);
  const overloaded = getHandling(WORLD.capacity + 1);

  assert.equal(overloaded.overloaded, true);
  assert.ok(overloaded.mass > full.mass);
  assert.ok(overloaded.acceleration < full.acceleration);
  assert.ok(overloaded.maxSpeed < full.maxSpeed);
  assert.ok(overloaded.collisionDamage > full.collisionDamage);
});

test("six passengers board and leave in exactly two batches of three", () => {
  let passengers = createPassengers();
  assert.equal(countPassengers(passengers, "waiting"), 6);

  const firstBoard = boardPassengers(passengers, WORLD.capacity);
  passengers = firstBoard.passengers;
  assert.equal(firstBoard.boarded, 3);
  assert.equal(countPassengers(passengers, "aboard"), 3);

  const firstDelivery = deliverPassengers(passengers);
  passengers = firstDelivery.passengers;
  assert.equal(firstDelivery.delivered, 3);
  assert.equal(countPassengers(passengers, "delivered"), 3);

  const secondBoard = boardPassengers(passengers, WORLD.capacity);
  passengers = secondBoard.passengers;
  assert.equal(secondBoard.boarded, 3);
  assert.equal(countPassengers(passengers, "aboard"), 3);
  assert.equal(countPassengers(passengers, "waiting"), 0);

  const secondDelivery = deliverPassengers(passengers);
  passengers = secondDelivery.passengers;
  assert.equal(secondDelivery.delivered, 3);
  assert.equal(countPassengers(passengers, "delivered"), PASSENGERS.length);
});

test("boarding cannot exceed capacity or duplicate a passenger", () => {
  let passengers = createPassengers();
  passengers = boardPassengers(passengers, 2).passengers;
  assert.equal(countPassengers(passengers, "aboard"), 2);

  const overflow = boardPassengers(passengers, 99);
  passengers = overflow.passengers;
  assert.equal(overflow.boarded, 1);
  assert.equal(countPassengers(passengers, "aboard"), 3);
  assert.equal(new Set(passengers.map(({ id }) => id)).size, 6);

  const repeated = boardPassengers(passengers, 3);
  assert.equal(repeated.boarded, 0);
});

test("the objective advances through loading, northbound, and the final return", () => {
  let passengers = createPassengers();
  assert.equal(getObjective(passengers).key, "south");

  passengers = boardPassengers(passengers, 3).passengers;
  assert.equal(getObjective(passengers).key, "north");

  passengers = deliverPassengers(passengers).passengers;
  passengers = boardPassengers(passengers, 3).passengers;
  passengers = deliverPassengers(passengers).passengers;
  assert.equal(getObjective(passengers).key, "return");
  assert.equal(countPassengers(passengers, "delivered"), 6);
});
