/* 模拟内核恢复过程测试：node test/sim.test.js */
const assert = require('assert');
const { createSim } = require('../src/sim.js');

function goodStrategy() {
  const sim = createSim();
  const c = sim.controls;
  while (sim.state.status === 'running' && sim.state.time < 120) {
    const s = sim.state;
    const A = s.branches.A;
    const B = s.branches.B;
    if (A.jammed && !A.paused) { c.pause('A'); c.setDiverter('B'); }
    if (B.jammed && !B.paused) { c.pause('B'); c.setDiverter('A'); }
    if (A.paused && !A.jammed && A.resumeTimer === 0 && B.paused === false) {
      c.setSpeed('slow'); c.resume('A'); c.setDiverter('AUTO');
    }
    if (B.paused && !B.jammed && B.resumeTimer === 0 && A.paused === false && A.flushed) {
      c.setSpeed('slow'); c.resume('B'); c.setDiverter('AUTO');
    }
    if (A.flushed && B.flushed && s.speed !== 'normal') c.setSpeed('normal');
    sim.step();
  }
  return sim.state;
}

function biasJamStrategy() {
  const sim = createSim();
  const c = sim.controls;
  while (sim.state.status === 'running' && sim.state.time < 120) {
    const s = sim.state;
    c.setSpeed('fast');
    if (s.branches.A.jammed) c.setDiverter('A');
    else if (s.branches.B.jammed) c.setDiverter('B');
    sim.step();
  }
  return sim.state;
}

function noopStrategy() {
  const sim = createSim();
  while (sim.state.status === 'running' && sim.state.time < 120) sim.step();
  return sim.state;
}

const good = goodStrategy();
assert.strictEqual(good.status, 'won', '正确调度应通关');
assert.strictEqual(good.goods, 10, '应恰好产出 10 件成品');
assert.strictEqual(good.totals.overflow, 0, '全程无溢出');
assert.strictEqual(good.branches.A.flushed, true, 'A 段缓存已清空');
assert.strictEqual(good.branches.B.flushed, true, 'B 段缓存已清空');
assert.ok(good.switches >= 4, '应包含暂停/恢复/分流/变速操作');

const bad = biasJamStrategy();
assert.strictEqual(bad.status, 'failed', '偏向堵塞支线应失败');
assert.ok(bad.failReason.includes('堵塞点溢出'), '失败原因应为堵点溢出');

const noop = noopStrategy();
assert.strictEqual(noop.status, 'failed', '不操作应因堵塞超时失败');
assert.ok(noop.failReason.includes('堵塞超时'), '失败原因应为堵塞超时');

console.log('全部测试通过：');
console.log('  正确调度 -> 通关 t=%ss goods=%d switches=%d 无溢出', good.time.toFixed(1), good.goods, good.switches);
console.log('  偏向堵点 -> 失败 t=%ss %s', bad.time.toFixed(1), bad.failReason);
console.log('  不作处理 -> 失败 t=%ss %s', noop.time.toFixed(1), noop.failReason);
