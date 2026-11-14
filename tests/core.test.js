"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../game-core.js");

function loadBoth(game) {
  assert.equal(Core.togglePackage(game, "PKG-A", 0).ok, true);
  assert.equal(Core.togglePackage(game, "PKG-B", 0).ok, true);
}

test("fixed scenario completes both deliveries with a usable reserve", () => {
  const game = Core.createGame(0);
  loadBoth(game);

  const heavyLeg = Core.getRouteQuote(game, "T1");
  assert.equal(heavyLeg.factor, 1.64);
  assert.equal(heavyLeg.energy, 66);

  assert.equal(Core.beginFlight(game, "T1", 1000).ok, true);
  Core.tick(game, 7000);
  assert.equal(game.status, "ready");
  assert.equal(game.currentPlatformId, "T1");
  assert.equal(game.deliveredCount, 1);
  assert.equal(game.batteries[0].charge, 34);

  assert.equal(Core.beginFlight(game, "R1", 7100).ok, true);
  Core.tick(game, 10800);
  assert.equal(game.currentPlatformId, "R1");
  assert.equal(game.batteries[0].charge, 1.3);

  assert.equal(Core.installBattery(game, "BAT-02", 11000).ok, true);
  assert.equal(Core.beginFlight(game, "T2", 11100).ok, true);
  Core.tick(game, 18400);

  assert.equal(game.status, "won");
  assert.equal(game.deliveredCount, 2);
  assert.equal(game.swapCount, 1);
  assert.ok(game.timeLeft > 0);
  assert.ok(Core.usableBatteryCount(game) >= 1);
});

test("a 78-degree critical battery reaches thermal lock in flight", () => {
  const game = Core.createGame(0);
  loadBoth(game);
  assert.equal(Core.installBattery(game, "BAT-04", 0).ok, true);
  assert.equal(Core.beginFlight(game, "T1", 1000).ok, true);

  Core.tick(game, 5000);
  const critical = Core.batteryById(game, "BAT-04");

  assert.equal(game.status, "lost");
  assert.equal(game.lossReason, "thermal-lock");
  assert.equal(critical.heat, 100);
  assert.ok(game.flight.progress > 0.5);
  assert.ok(game.flight.progress < 1);
  assert.equal(game.deliveredCount, 0);
});

test("ground thermal lock blocks takeoff until cooling finishes", () => {
  const game = Core.createGame(0);
  loadBoth(game);
  Core.installBattery(game, "BAT-04", 0);
  Core.batteryById(game, "BAT-04").heat = 90;
  assert.equal(Core.startMission(game, 500).ok, true);

  const blocked = Core.beginFlight(game, "T1", 1000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "thermal-lock");
  assert.equal(game.status, "ready");
  assert.equal(game.flight, null);

  assert.equal(Core.startCooling(game, 1200).ok, true);
  assert.equal(game.status, "cooling");
  Core.tick(game, 5300);
  assert.equal(game.status, "ready");
  assert.equal(Core.batteryById(game, "BAT-04").heat, 64);
  assert.equal(Core.beginFlight(game, "T1", 5400).ok, true);
});

test("carrying a second package increases energy and heat", () => {
  const game = Core.createGame(0);
  const emptyQuote = Core.getRouteQuote(game, "T1");

  Core.togglePackage(game, "PKG-A", 0);
  const singleQuote = Core.getRouteQuote(game, "T1");
  Core.togglePackage(game, "PKG-B", 0);
  const overloadedQuote = Core.getRouteQuote(game, "T1");

  assert.ok(singleQuote.energy > emptyQuote.energy);
  assert.ok(overloadedQuote.energy > singleQuote.energy);
  assert.ok(overloadedQuote.heatGain > singleQuote.heatGain);
  assert.equal(overloadedQuote.overloadPercent, 64);
});
