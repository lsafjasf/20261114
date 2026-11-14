// 两种空闲回位策略的 A/B 对比（同一客流、同一速度与停靠策略）
const S = require('../js/simulation.js');

const BUDGET = 1600;
const COMMON = {
  speeds: ['medium', 'medium', 'medium'],
  strategies: ['collective', 'collective', 'collective'],
  budget: BUDGET,
};

const scenarios = [
  { name: 'A 大堂回位（全员空闲回 1 层）', homes: [1, 1, 1] },
  { name: 'B 分区回位（低/中/高 1·4·7）', homes: [1, 4, 7] },
  { name: 'C 中层回位（全员空闲回 4 层）', homes: [4, 4, 4] },
];

const rows = scenarios.map((sc) => {
  const sim = new S.Simulation({ ...COMMON, homes: sc.homes });
  const r = sim.runHeadless();
  return { name: sc.name, r };
});

console.log('电量预算：' + BUDGET + ' 度｜时限：' + S.TIME_LIMIT +
  's｜投诉上限：' + S.COMPLAINT_LIMIT + '\n');
for (const { name, r } of rows) {
  console.log(name);
  console.log('  结果: ' + (r.success ? '成功' : '失败(' + r.reasons.join('，') + ')'));
  console.log('  完成时间=' + r.time.toFixed(1) + 's  耗电=' + Math.round(r.energy) +
    ' 度  启停=' + r.starts + ' 次  投诉=' + r.complaints +
    '  平均等待=' + r.avgWait.toFixed(1) + 's  最长等待=' + Math.round(r.maxWait) + 's');
}

const [a, b] = rows;
console.log('\n--- A vs B 差异 ---');
console.log('耗电差: ' + Math.round(b.r.energy - a.r.energy) + ' 度（B 相对 A）');
console.log('启停差: ' + (b.r.starts - a.r.starts) + ' 次');
console.log('完成时间差: ' + (b.r.time - a.r.time).toFixed(1) + 's');
console.log('平均等待差: ' + (b.r.avgWait - a.r.avgWait).toFixed(1) + 's');
