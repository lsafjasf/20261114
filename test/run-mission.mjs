// 无头验收：实际执行一次完整任务，验证「稳态调节」与「压力尖峰处理」。
import assert from 'node:assert/strict';
import { runMission } from '../director.js';
import { LIMITS } from '../sim.js';

const trace = [];
const { sim, dir } = runMission(0.05, 100, (s, d) => {
  if (trace.length === 0 || d.phase !== trace[trace.length - 1].phase) {
    trace.push({ phase: d.phase, t: s.t, temp: s.temp, pressure: s.pressure, flow: s.flow, spike: s.spike });
  }
});

const line = (o) =>
  `t=${o.t.toFixed(2)}s T=${o.temp.toFixed(1)}℃ P=${o.pressure.toFixed(2)}bar F=${o.flow.toFixed(2)}kg/s spike=${o.spike.toFixed(2)}`;

console.log('--- 阶段轨迹 ---');
trace.forEach((o) => console.log(`${o.phase.padEnd(9)} ${line(o)}`));

const p1 = dir.phase1Stats;
console.log('\n--- 科目一：稳态调节 ---');
console.log('达成时刻 t =', p1.t.toFixed(2), 's');
console.log(`稳态 T=${p1.temp.toFixed(1)}℃ (目标<78, 限值 ${LIMITS.temp.high}℃)`);
console.log(`稳态 P=${p1.pressure.toFixed(2)}bar (限值 ${LIMITS.pressure.high})`);
console.log(`稳态 F=${p1.flow.toFixed(2)}kg/s (窗口 ${LIMITS.flow.low}~${LIMITS.flow.high})`);
console.log(`备用电力剩余 ${p1.battery.toFixed(1)}%（累计耗电 ${(100 - p1.battery).toFixed(1)}%）`);

console.log('\n--- 科目二：压力尖峰处理 ---');
console.log(`尖峰次数=${sim.metrics.spikeCount} 峰值压力=${sim.metrics.maxPressure.toFixed(2)}bar 最大尖峰增量=${sim.metrics.spikePeak.toFixed(2)}bar`);
console.log(`尖峰处置完成 t=${sim.t.toFixed(2)}s, 最终 P=${sim.pressure.toFixed(2)}bar T=${sim.temp.toFixed(1)}℃ F=${sim.flow.toFixed(2)}kg/s`);

assert.equal(sim.failed, false, `任务不应失败：${sim.failReason}`);
assert.equal(dir.steadyDone, true, '稳态调节科目应完成');
assert.equal(dir.spikeHandled, true, '压力尖峰处理科目应完成');
assert.ok(p1.temp < 78, '稳态温度应压回安全窗口');
assert.ok(p1.pressure < LIMITS.pressure.warnHigh, '稳态压力应低于告警线');
assert.ok(p1.flow > LIMITS.flow.warnLow && p1.flow < LIMITS.flow.warnHigh, '稳态流量应在安全窗口');
assert.ok(sim.metrics.maxPressure > LIMITS.pressure.warnHigh, '快关应真实制造一次压力尖峰');
assert.ok(sim.metrics.maxPressure <= LIMITS.pressure.high, '尖峰不应直接击穿硬限值');
assert.ok(sim.pressure < LIMITS.pressure.warnHigh, '处置后压力应回落至告警线以下');
assert.ok(sim.battery > 0, '备用电力不应耗尽');
assert.ok(sim.t < 90, '任务应在合理时间内结束');

console.log('\n✅ 全部断言通过：两个科目均实际完成，无持续越限、无电力耗尽。');
