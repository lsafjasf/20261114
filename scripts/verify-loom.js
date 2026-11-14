import { mkdir, writeFile } from "node:fs/promises";
import {
  LoomSimulation,
  LOOM_CONFIG,
  TEST_SETTINGS,
} from "../src/loom-sim.js";

const finished = new LoomSimulation({ seed: 20261114 });
finished.setSettings(TEST_SETTINGS);
finished.start();

while (finished.status === "running") {
  finished.weaveNextPick(TEST_SETTINGS);
}

const fabric = finished.getSnapshot();
const brokenLoom = new LoomSimulation({ seed: 20261114 });
const breakSettings = { opening: 50, tension: 3.3, speed: 3.1 };
brokenLoom.setSettings(breakSettings);
brokenLoom.start();
brokenLoom.weaveNextPick(breakSettings);
const breakTest = brokenLoom.getSnapshot();

const report = {
  generatedAt: new Date().toISOString(),
  fabricTest: {
    status: fabric.status,
    lengthCm: fabric.progressCm,
    rows: fabric.rowsDone,
    defects: fabric.defects,
    defectLimit: LOOM_CONFIG.defectLimit,
    breakages: fabric.breakages.length,
    success: fabric.success,
  },
  threadBreakTest: {
    status: breakTest.status,
    reason: breakTest.failureReason,
    breakPosition: breakTest.breakages[0]?.position,
    tension: breakTest.breakages[0]?.tension,
    success: breakTest.success,
  },
};

if (!fabric.success) throw new Error("Fabric verification did not succeed");
if (breakTest.status !== "broken") throw new Error("Thread break was not detected");

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/verification.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
