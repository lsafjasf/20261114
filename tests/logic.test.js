import test from "node:test";
import assert from "node:assert/strict";
import { MODULES, MODULE_BY_ID, RESOURCE_TARGETS, SOLUTION } from "../src/data.js";
import {
  facesFor,
  getSolutionTarget,
  nextHint,
  placementsFromSolution,
  resourcesFor,
  rotateFaces,
  validateCamp,
} from "../src/logic.js";

test("blueprint uses all twelve unique modules on the grid", () => {
  assert.equal(MODULES.length, 12);
  assert.equal(SOLUTION.length, 12);
  assert.equal(new Set(SOLUTION.map((entry) => entry.moduleId)).size, 12);
  assert.equal(
    new Set(SOLUTION.map((entry) => `${entry.x},${entry.y}`)).size,
    12,
  );
});

test("blueprint meets all resource targets", () => {
  const counts = resourcesFor(placementsFromSolution());
  assert.deepEqual(counts, RESOURCE_TARGETS);
});

test("the complete blueprint passes every startup check", () => {
  const report = validateCamp(placementsFromSolution());
  assert.equal(report.ok, true, report.issues.map((issue) => issue.detail).join("\n"));
  assert.equal(report.interfaceErrors.length, 0);
  assert.equal(report.seal.connected, true);
  assert.equal(report.power.connected, true);
  assert.equal(report.oxygen.connected, true);
});

test("four clockwise turns restore the original face pattern", () => {
  for (const module of MODULES) {
    assert.deepEqual(rotateFaces(module.faces, 4), module.faces);
    assert.deepEqual(rotateFaces(rotateFaces(module.faces, 1), 3), module.faces);
  }
});

test("a rotated solution has an interface error", () => {
  const placements = placementsFromSolution();
  placements[0].rotation = 1;
  const report = validateCamp(placements);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "interface"));
});

test("removing a module fails resources and module count", () => {
  const placements = placementsFromSolution().filter((entry) => entry.moduleId !== "hab-alpha");
  const report = validateCamp(placements);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "modules"));
  assert.ok(report.issues.some((issue) => issue.code === "resource"));
});

test("an exposed conduit is reported as an unsealed interface", () => {
  const placements = [{ moduleId: "hab-alpha", x: 2, y: 2, rotation: 0 }];
  const report = validateCamp(placements);
  assert.equal(report.ok, false);
  assert.equal(report.exposedPorts.length, 2);
  assert.ok(report.issues.some((issue) => issue.title.includes("接口方向")));
});

test("every blueprint target can be queried for the hint system", () => {
  for (const entry of SOLUTION) {
    const target = getSolutionTarget(entry.moduleId);
    assert.deepEqual(target, entry);
  }
  assert.equal(nextHint(placementsFromSolution()), null);
  assert.equal(nextHint([]).moduleId, SOLUTION[0].moduleId);
});

test("faces preserve the authored directions at rotation zero", () => {
  assert.deepEqual(facesFor(MODULE_BY_ID["hab-alpha"], 0), ["X", "P", "O", "X"]);
  assert.deepEqual(facesFor(MODULE_BY_ID["hab-alpha"], 1), ["X", "X", "P", "O"]);
});
