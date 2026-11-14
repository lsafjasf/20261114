/* 验证：自动寻优 + 多种子 180 秒通关 */
const S = require('./src/sim.js');

console.log('== 信号配时自动寻优 ==');
const t0 = Date.now();
const r = S.optimize([3, 11, 22, 33, 44, 55, 77, 101]);
console.log(`网格搜索 ${r.tested} 组可行配置，耗时 ${Date.now() - t0} ms`);
if (!r.best) { console.error('✗ 未找到可行配置'); process.exit(1); }
const b = r.best;
console.log(`最优配置: 东西绿 ${b.ewGreen}s / 南北绿 ${b.nsGreen}s / 黄灯 ${b.yellow}s / ${b.leftFirst ? '先左转' : '先直行'}`);

console.log('\n== 最优配置 20 个随机种子复验 ==');
let pass = 0, worstQ = 0, waitSum = 0, effSum = 0, passedSum = 0;
for (let seed = 1; seed <= 20; seed++) {
  const sim = S.createSim({
    ewGreen: b.ewGreen, nsGreen: b.nsGreen, yellow: b.yellow,
    leftFirst: b.leftFirst, seed
  });
  while (!sim.finished) sim.step(0.1);
  if (!sim.failed) pass++;
  worstQ = Math.max(worstQ, sim.maxQueue());
  waitSum += sim.avgWait();
  effSum += sim.efficiency();
  passedSum += sim.passed;
}
console.log(`通过 ${pass}/20，峰值排队 ${worstQ} 辆（阈值 16）`);
console.log(`平均等待 ${(waitSum / 20).toFixed(1)} s，绿灯利用率 ${(effSum / 20 * 100).toFixed(0)}%，平均通过 ${(passedSum / 20).toFixed(0)} 辆`);
if (pass < 20) { console.error('✗ 存在失败种子'); process.exit(1); }

console.log('\n== 默认配时应具有挑战性 ==');
const d = S.createSim({ seed: 1 });
while (!d.finished) d.step(0.1);
console.log(d.failed ? `✓ 默认 32/28/3 在 ${d.t.toFixed(0)}s 失败（${d.failReason} 进口溢出），需要玩家优化` : '✗ 默认配置直接通过，难度不足');
if (!d.failed) process.exit(1);

console.log('\n== 运行中实时改配时 ==');
const live = S.createSim({ seed: 7 });
for (let i = 0; i < 600; i++) live.step(0.1);
live.reconfigure({ ewGreen: b.ewGreen, nsGreen: b.nsGreen, yellow: b.yellow, leftFirst: b.leftFirst });
while (!live.finished) live.step(0.1);
console.log(live.failed ? `✗ 实时应用后失败（${live.failReason}）` : `✓ 实时应用后跑满 180s，峰值排队 ${live.maxQueue()}`);
if (live.failed) process.exit(1);

console.log('\n全部验证通过 ✓');
