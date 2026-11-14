import assert from "node:assert/strict";
import {
  PROFILE_SAMPLES,
  applyBrush,
  buildSection,
  createTerrain,
  faultCrossings,
  sampleHeight,
  validateSection,
} from "../src/terrain.js";

function checkTerrain(label, presetId) {
  const terrain = createTerrain(presetId);
  const result = validateSection(terrain);
  const section = buildSection(terrain);

  assert.equal(result.valid, true, `${label}: section should validate`);
  assert.equal(result.samples, PROFILE_SAMPLES, `${label}: expected fixed sample count`);
  assert.equal(section.points.length, PROFILE_SAMPLES, `${label}: section should expose all points`);
  assert.ok(result.maxError <= 0.000001, `${label}: section must match grid sampling`);
  assert.ok(section.minTop < section.maxTop, `${label}: terrain should have relief`);

  for (const point of section.points) {
    assert.ok(Number.isFinite(point.top), `${label}: height must be finite at x=${point.x}`);
    assert.ok(point.top >= 0 && point.top <= 1, `${label}: height must be normalized at x=${point.x}`);
    const direct = sampleHeight(terrain, point.x, terrain.cutPosition);
    assert.ok(Math.abs(direct - point.top) < 0.000001, `${label}: cut must be recomputed from the mesh`);
  }
  return { terrain, section, result };
}

const canyon = checkTerrain("canyon", "canyon");
const mesa = checkTerrain("mesa", "mesa");

const signatureCanyon = canyon.section.points.map((point) => point.top);
const signatureMesa = mesa.section.points.map((point) => point.top);
const terrainDifference = Math.max(
  ...signatureCanyon.map((height, index) => Math.abs(height - signatureMesa[index])),
);
assert.ok(terrainDifference > 0.01, "the two terrain profiles should describe genuinely different geometry");

const cutA = buildSection(canyon.terrain, 0.34);
const cutB = buildSection(canyon.terrain, 0.74);
const cutDifference = Math.max(
  ...cutA.points.map((point, index) => Math.abs(point.top - cutB.points[index].top)),
);
assert.ok(cutDifference > 0.005, "moving the cut plane must recalculate a different profile");

const edited = createTerrain("canyon");
const baseline = buildSection(edited).points.map((point) => point.top);
const brushChanged = applyBrush(edited, 0.58, 0.66, 0.12, "lower", 0.03);
assert.equal(brushChanged, true, "brush should modify at least one grid cell");
const editedSection = buildSection(edited);
assert.equal(validateSection(edited).valid, true, "edited terrain section should remain valid");
const editedDifference = Math.max(
  ...editedSection.points.map((point, index) => Math.abs(point.top - baseline[index])),
);
assert.ok(editedDifference > 0.01, "an edit to the mesh must change the live section");

const fault = createTerrain("fault");
const crossings = faultCrossings(fault);
assert.equal(crossings.length, 1, "fault preset should expose one fault crossing at the cut plane");
assert.ok(validateSection(fault).valid, "faulted terrain section should remain valid");

console.log("Section consistency check passed");
console.log(JSON.stringify({
  presets: {
    canyon: { samples: canyon.result.samples, maxError: canyon.result.maxError },
    mesa: { samples: mesa.result.samples, maxError: mesa.result.maxError },
  },
  terrainDifference: Number(terrainDifference.toFixed(5)),
  cutDifference: Number(cutDifference.toFixed(5)),
  editedDifference: Number(editedDifference.toFixed(5)),
  faultCrossings: crossings.length,
}, null, 2));
