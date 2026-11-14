import assert from 'node:assert/strict';
import {
  DURATION_SECONDS,
  PASS_STORAGE_LITERS,
  WaterStationSimulation
} from '../js/simulation.js';

const stable = new WaterStationSimulation();
stable.run(DURATION_SECONDS, (simulation, elapsed) => {
  simulation.setControl('bypass', elapsed < 120 ? 18 : 25);
  simulation.setControl('pumpPressure', 65);
  simulation.setControl('backwashCycle', 150);
});

assert.equal(stable.elapsed, DURATION_SECONDS);
assert.equal(stable.failureReason, null);
assert.equal(stable.passed, true);
assert.ok(stable.minStorage >= PASS_STORAGE_LITERS);
assert.ok(stable.membranes.every((membrane) => !membrane.clogged));
assert.ok(stable.membranes.every((membrane) => membrane.fouling < 90));
assert.ok(stable.membranes.every((membrane) => membrane.life > 70));

const blocked = new WaterStationSimulation({
  bypass: 100,
  pumpPressure: 100,
  backwashCycle: 360,
  autoBackwash: false
});
blocked.run(DURATION_SECONDS);

assert.equal(blocked.passed, false);
assert.match(blocked.failureReason, /堵塞/);
assert.ok(blocked.membranes.some((membrane) => membrane.clogged));
assert.ok(blocked.elapsed < DURATION_SECONDS);

const backwash = new WaterStationSimulation({
  bypass: 45,
  pumpPressure: 80,
  autoBackwash: false
});
backwash.run(20);
backwash.requestBackwash();
const foulingBefore = Math.max(...backwash.membranes.map((membrane) => membrane.fouling));
backwash.run(7);
const backwashed = backwash.membranes
  .filter((membrane) => !membrane.backwashing)
  .sort((a, b) => a.fouling - b.fouling)[0];

assert.equal(backwash.backwash, null);
assert.ok(Math.abs(backwash.backwashWaterUsed - 54) < 0.1);
assert.ok(backwashed.fouling < foulingBefore * 0.5);

console.log('稳定运行：通过，最低储水', stable.minStorage.toFixed(1), 'L，最终储水', stable.storage.toFixed(1), 'L');
console.log('膜堵塞：', blocked.failureReason, '，发生于', blocked.elapsed, '秒');
console.log('反洗机制：耗水', backwash.backwashWaterUsed.toFixed(1), 'L，污染降至', backwashed.fouling.toFixed(1), '%');
console.log('稳定运行、膜堵塞和反洗机制验证通过');
