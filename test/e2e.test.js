'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, GraspSim, OBJECTS } = require('../js/sim.js');

// 模拟玩家完整调参过程：先试错，再采用稳定策略，完成三次无损伤抓取。
const PLAYER_JOURNEY = {
  soft: {
    badAttempt: { pressure: 60, speed: 75, feedback: 60 }, // 直觉调大 -> 压坏
    tuned: { pressure: 20, speed: 20, feedback: 20 },
  },
  medium: {
    badAttempt: { pressure: 60, speed: 85, feedback: 60 }, // 太快 -> 超调压坏
    tuned: { pressure: 36, speed: 45, feedback: 36 },
  },
  hard: {
    badAttempt: { pressure: 25, speed: 30, feedback: 25 }, // 力太小 -> 打滑
    tuned: { pressure: 65, speed: 60, feedback: 65 },
  },
};

test('玩家完整流程：每种物体先失败再调优，最终三次全部无损伤通过', () => {
  const finalReport = [];
  for (const objectId of ['soft', 'medium', 'hard']) {
    const journey = PLAYER_JOURNEY[objectId];

    const bad = evaluate({ objectId, ...journey.badAttempt });
    assert.equal(bad.pass, false, `${objectId} 的错误策略应当失败`);

    const tunedMetrics = evaluate({ objectId, ...journey.tuned });
    assert.equal(tunedMetrics.pass, true, `${objectId} 调优后静态评估应通过`);

    const sim = new GraspSim({ objectId, ...journey.tuned });
    sim.start();
    let frames = 0;
    while (!sim.passed && !sim.failed && frames < 2000) {
      sim.update(1 / 60);
      frames++;
    }
    assert.equal(sim.passed, true, `${objectId} 动画状态机应走到 passed`);
    assert.equal(sim.failed, false);
    assert.ok(sim.peakSeen <= OBJECTS[objectId].maxSafe, `${objectId} 峰值力不得超过安全上限`);

    finalReport.push({
      object: OBJECTS[objectId].label,
      params: journey.tuned,
      peakN: Number(sim.peakSeen.toFixed(2)),
      maxSafeN: OBJECTS[objectId].maxSafe,
      slipRisk: Number((tunedMetrics.slipRisk * 100).toFixed(1)),
      deformPct: Number(tunedMetrics.deformPct.toFixed(1)),
      frames,
    });
  }

  assert.equal(finalReport.length, 3);
  // 软物必须比硬物更慢更轻，验证策略差异而非同一组参数通关
  assert.ok(finalReport[0].params.speed < finalReport[2].params.speed);
  assert.ok(finalReport[0].params.pressure < finalReport[2].params.pressure);
  console.log('\n三次无损伤抓取报告：');
  console.table(finalReport);
});
