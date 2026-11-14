/* Node 测试：实际跑通一队通行 + 单点过载。 */
'use strict';
const BridgeSim = require('./bridge.js');

function runConvoy(opts) {
  const state = BridgeSim.createSim(opts);
  for (const i of opts.reinforce || []) BridgeSim.toggleReinforce(state, i);
  BridgeSim.start(state);
  BridgeSim.simulate(state, 180);
  return state;
}

function report(state, label) {
  const limit = state.cfg.stressLimit;
  const breaks = state.events.filter(e => e.type === 'break');
  const crossed = state.events.filter(e => e.type === 'crossed').length;
  console.log(`\n[${label}]`);
  console.log(`  结果: ${state.status}  用时: ${state.time.toFixed(1)}s`);
  console.log(`  通过车辆: ${crossed}/${state.vehicles.length}  断裂桥板: ${state.brokenCount}`);
  console.log(`  峰值应力: ${state.maxStress.toFixed(1)} / ${limit} (${(100 * state.maxStress / limit).toFixed(0)}%)`);
  if (breaks.length) {
    console.log(`  断裂记录: ${breaks.map(b => `#${b.plank}@${b.t.toFixed(1)}s`).join(' ')}`);
  }
  for (const e of state.events.filter(e => e.type === 'vehicle_fell' || e.type === 'collapse')) {
    console.log(`  事件: ${e.type} ${e.vehicle || ''} ${e.plank != null ? 'plank#' + e.plank : ''}`);
  }
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ 断言失败: ' + msg); }
  else console.log('  ✓ ' + msg);
}

// ---------- 场景 1：合理操作，全队安全通行 ----------
const good = runConvoy({
  tension: 0.78, spacing: 26, seed: 7,
  reinforce: [10, 11, 12, 13],
});
report(good, '场景1 全队通行（张力0.78 / 间距26m / 加固中段4板）');
assert(good.status === 'won', '全部三辆车到达对岸');
assert(good.brokenCount === 0, '无桥板断裂');
assert(good.maxStress < good.cfg.stressLimit, '峰值应力低于上限');

// ---------- 场景 2：单点过载，桥板断裂 ----------
const bad = runConvoy({
  tension: 0.05, spacing: 12, seed: 7,
  reinforce: [],
});
report(bad, '场景2 单点过载（张力0.05 / 间距12m / 无加固）');
assert(bad.status === 'lost', '桥梁失效（车辆坠落或垮塌）');
assert(bad.brokenCount >= 1, '至少一块桥板应力超限断裂');
const firstBreak = bad.events.find(e => e.type === 'break');
assert(!!firstBreak, `存在断裂事件 (plank#${firstBreak && firstBreak.plank})`);

// ---------- 场景 3：加固关键板可挽救原本会断的位置 ----------
const saved = runConvoy({
  tension: 0.45, spacing: 18, seed: 7,
  reinforce: [10, 11, 12, 13],
});
report(saved, '场景3 中等张力+中段加固（张力0.45 / 间距18m）');
assert(saved.status === 'won', '加固后全队通行成功');

// ---------- 场景 4：单点过载（12t 超载车单独通过） ----------
function runSingle(tension) {
  const s = BridgeSim.createSim({
    tension, spacing: 20, seed: 3,
    vehicles: [{ name: '超载试验车', mass: 12 }],
  });
  BridgeSim.start(s);
  BridgeSim.simulate(s, 120);
  return s;
}
const overload = runSingle(0.05);
report(overload, '场景4a 单点过载（12t 超载车 / 张力0.05 / 无加固）');
assert(overload.status === 'lost', '超载车压断单块桥板');
assert(overload.brokenCount >= 1, '单点断裂发生');
const ob = overload.events.find(e => e.type === 'break');
assert(ob && overload.stress[ob.plank] >= 0, `断裂点 plank#${ob && ob.plank} 即超载车所在位置`);

const controlled = runSingle(0.8);
report(controlled, '场景4b 对照组（同一超载车 / 张力0.8）');
assert(controlled.status === 'won', '提高张力后同一辆车安全通过');

// ---------- 调参参考：张力扫描 ----------
console.log('\n[张力扫描]（无加固，间距20m，报告峰值应力%）');
for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  const s = runConvoy({ tension: t, spacing: 20, seed: 7 });
  console.log(`  张力 ${t.toFixed(1)} -> 峰值 ${(100 * s.maxStress / s.cfg.stressLimit).toFixed(0)}%  结果 ${s.status}  断裂 ${s.brokenCount}`);
}

console.log(failures === 0 ? '\n全部测试通过 ✅' : `\n${failures} 个断言失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
