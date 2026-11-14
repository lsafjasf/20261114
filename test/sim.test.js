'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, GraspSim, OBJECTS } = require('../js/sim.js');

// 三种物体的稳定抓握策略（玩家最终采用的参数）
const STRATEGIES = {
  soft:   { pressure: 20, speed: 20, feedback: 20 }, // 慢速、低压、低阈值
  medium: { pressure: 36, speed: 45, feedback: 36 },
  hard:   { pressure: 65, speed: 60, feedback: 65 }, // 高指力防滑、阈值兜底防压坏
};

for (const objectId of Object.keys(OBJECTS)) {
  test(`${objectId}: 稳定策略应无损通过`, () => {
    const r = evaluate({ objectId, ...STRATEGIES[objectId] });
    assert.equal(r.crushed, false);
    assert.equal(r.liftSlip, false);
    assert.equal(r.pass, true);
    assert.ok(r.crushMargin > 0, '应有正向压坏余量');
    assert.ok(r.gripMargin > 0, '应有正向防滑余量');
  });
}

test('软物：高指力会压坏', () => {
  const r = evaluate({ objectId: 'soft', pressure: 70, speed: 80, feedback: 70 });
  assert.equal(r.crushed, true);
  assert.equal(r.pass, false);
});

test('软物：即使低压，高速闭合的惯性超调也会压坏', () => {
  const r = evaluate({ objectId: 'soft', pressure: 30, speed: 90, feedback: 28 });
  assert.equal(r.crushed, true);
});

test('硬物：低指力提升时打滑', () => {
  const r = evaluate({ objectId: 'hard', pressure: 25, speed: 30, feedback: 25 });
  assert.equal(r.liftSlip, true);
  assert.equal(r.pass, false);
});

test('硬物：摩擦力最小，同等指力下滑移风险最高', () => {
  const params = { pressure: 50, speed: 50, feedback: 50 };
  const soft = evaluate({ objectId: 'soft', ...params });
  const hard = evaluate({ objectId: 'hard', ...params });
  assert.ok(hard.slipRatio > soft.slipRatio);
});

test('软物：同样力下形变最大', () => {
  const params = { pressure: 40, speed: 30, feedback: 40 };
  const soft = evaluate({ objectId: 'soft', ...params });
  const hard = evaluate({ objectId: 'hard', ...params });
  assert.ok(soft.deformPct > hard.deformPct);
});

test('反馈阈值限制实际持握力', () => {
  const r = evaluate({ objectId: 'hard', pressure: 90, speed: 40, feedback: 30 });
  assert.ok(r.holdAvg <= 18 + 1e-9); // 阈值 30 -> 0.3*30=18N
});

for (const objectId of Object.keys(OBJECTS)) {
  test(`状态机 ${objectId}: 逐帧推进到 passed 且无损`, () => {
    const sim = new GraspSim({ objectId, ...STRATEGIES[objectId] });
    sim.start();
    for (let i = 0; i < 600 && !sim.passed && !sim.failed; i++) sim.update(1 / 60);
    assert.equal(sim.passed, true);
    assert.equal(sim.failed, false);
    assert.ok(sim.peakSeen <= OBJECTS[objectId].maxSafe);
    const s = sim.snapshot();
    assert.ok(s.liftHeight > 60);
  });
}

test('状态机：软物高压策略在压缩阶段触发压坏', () => {
  const sim = new GraspSim({ objectId: 'soft', pressure: 70, speed: 80, feedback: 70 });
  sim.start();
  for (let i = 0; i < 600 && !sim.passed && !sim.failed; i++) sim.update(1 / 60);
  assert.equal(sim.failed, true);
  assert.match(sim.reason, /压坏/);
});

test('状态机：硬物低压策略在提升阶段滑脱', () => {
  const sim = new GraspSim({ objectId: 'hard', pressure: 25, speed: 30, feedback: 25 });
  sim.start();
  for (let i = 0; i < 600 && !sim.passed && !sim.failed; i++) sim.update(1 / 60);
  assert.equal(sim.failed, true);
  assert.match(sim.reason, /滑脱/);
  assert.ok(sim.slipOffset > 0);
});
