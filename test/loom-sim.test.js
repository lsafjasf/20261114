import test from "node:test";
import assert from "node:assert/strict";
import {
  LoomSimulation,
  LOOM_CONFIG,
  TEST_SETTINGS,
} from "../src/loom-sim.js";

test("calibrated settings weave a complete 10 cm fabric", () => {
  const loom = new LoomSimulation({ seed: 220 });
  loom.setSettings(TEST_SETTINGS);
  loom.start();

  let guard = 0;
  while (loom.status === "running" && guard < 100) {
    loom.weaveNextPick(TEST_SETTINGS);
    guard += 1;
  }

  const result = loom.getSnapshot();
  assert.equal(result.status, "complete");
  assert.equal(result.rowsDone, LOOM_CONFIG.totalRows);
  assert.equal(result.progressCm, LOOM_CONFIG.lengthCm);
  assert.ok(result.defects < LOOM_CONFIG.defectLimit);
  assert.equal(result.breakages.length, 0);
  assert.equal(result.success, true);
});

test("excessive tension breaks a weft thread before completion", () => {
  const loom = new LoomSimulation({ seed: 17 });
  const dangerous = { opening: 50, tension: 3.3, speed: 3.1 };
  loom.setSettings(dangerous);
  loom.start();

  for (let pick = 0; pick < 3 && loom.status === "running"; pick += 1) {
    loom.weaveNextPick(dangerous);
  }

  const result = loom.getSnapshot();
  assert.equal(result.status, "broken");
  assert.equal(result.failureReason, "thread-break");
  assert.ok(result.breakages.length > 0);
  assert.equal(result.success, false);
});

test("opening offset produces diagonal defects", () => {
  const loom = new LoomSimulation({ seed: 9 });
  const offset = { opening: 86, tension: 1.8, speed: 3.1 };
  loom.setSettings(offset);
  loom.start();

  loom.weaveNextPick(offset);
  const result = loom.getSnapshot();

  assert.equal(result.rows[0].defectKinds.includes("diagonal"), true);
  assert.ok(result.defects > 0);
});

test("excessive shuttle speed produces misalignment", () => {
  const loom = new LoomSimulation({ seed: 31 });
  const tooFast = { opening: 50, tension: 1.8, speed: 5.6 };
  loom.setSettings(tooFast);
  loom.start();

  for (let pick = 0; pick < 8; pick += 1) {
    if (loom.status !== "running") break;
    loom.weaveNextPick(tooFast);
  }

  const result = loom.getSnapshot();
  const hasMisalignment = result.rows.some((row) =>
    row.defectKinds.includes("misaligned"),
  );
  assert.equal(hasMisalignment, true);
});
