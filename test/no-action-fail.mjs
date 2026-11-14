// 反向验收：玩家完全不干预时，升温节点必须因持续越限而失败。
import assert from 'node:assert/strict';
import { createSim, step, LIMITS } from '../sim.js';

const sim = createSim();
let peakT = sim.temp;
while (sim.running && sim.t < 120) {
  step(sim, 0.05);
  peakT = Math.max(peakT, sim.temp);
}

console.log(`不干预：峰值温度 ${peakT.toFixed(1)}℃，失败原因 = ${sim.failReason}`);
assert.equal(sim.failed, true, '不干预应当触发失败');
assert.match(sim.failReason, /温度/, '失败原因应是温度持续越限');
assert.ok(peakT > LIMITS.temp.warnHigh, '温度应确实越过告警线');
console.log('✅ 反向断言通过：放任不管会真实失败，失败计时机制有效。');
