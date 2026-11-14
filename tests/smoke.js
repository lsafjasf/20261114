const assert = require('assert');
const S = require('../js/simulation.js');

const base = {
  speeds: ['medium', 'medium', 'medium'],
  strategies: ['collective', 'collective', 'collective'],
  homes: [1, 4, 7],
  budget: 1600,
};

// 1. 确定性：相同配置两次结果完全一致
const r1 = new S.Simulation(base).runHeadless();
const r2 = new S.Simulation(base).runHeadless();
assert.deepStrictEqual(r1, r2, '仿真应具备确定性');

// 2. 中速默认局满足成功条件
assert.strictEqual(r1.success, true, '默认中速局应成功');
assert.strictEqual(r1.delivered, r1.total, '所有乘客必须送达');
assert.ok(r1.time <= S.TIME_LIMIT, '须在 8 分钟内完成');
assert.ok(r1.energy <= base.budget, '耗电不得超预算');
assert.ok(r1.complaints <= S.COMPLAINT_LIMIT, '投诉不得超限');

// 3. 低预算触发失败
const poor = new S.Simulation({ ...base, budget: 500 }).runHeadless();
assert.strictEqual(poor.success, false, '低预算应失败');
assert.ok(poor.reasons.some((x) => x.includes('预算')), '失败原因应包含预算');

// 4. 慢速 + 大堂回位至少出现 1 起投诉（压力场景）
const slow = new S.Simulation({
  ...base,
  speeds: ['slow', 'slow', 'slow'],
  homes: [1, 1, 1],
}).runHeadless();
assert.ok(slow.complaints >= 1, '慢速压力局应产生投诉，实际 ' + slow.complaints);

// 5. 快速比慢速更耗电
const fast = new S.Simulation({
  ...base, speeds: ['fast', 'fast', 'fast'],
}).runHeadless();
assert.ok(fast.energy > r1.energy, '快速档应更耗电');

// 6. 全程无乘客丢失：送达 + 任何时刻在梯/等候 = 总数
const sim = new S.Simulation(base);
let guard = 0;
while (!sim.finished && guard < 6000) {
  sim.step();
  const accounted = sim.delivered + sim.waiting.length +
    sim.cars.reduce((n, c) => n + c.occupants.length, 0) +
    sim.schedule.filter((p) => p.state === 'pending').length;
  assert.strictEqual(accounted, sim.schedule.length, '乘客守恒');
  guard += 1;
}
assert.strictEqual(sim.finished, true);

// 7. 能耗单调不减
let prev = -1;
const sim2 = new S.Simulation(base);
while (!sim2.finished) {
  sim2.step();
  assert.ok(sim2.energy >= prev, '能耗只增不减');
  prev = sim2.energy;
}

console.log('全部冒烟测试通过 ✔');
console.log('默认局:', JSON.stringify({
  time: r1.time, energy: Math.round(r1.energy),
  complaints: r1.complaints, starts: r1.starts,
  avgWait: Number(r1.avgWait.toFixed(1)),
}));
