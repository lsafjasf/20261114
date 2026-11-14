// test_scenarios.js — 无头验证：场景A 稳定运行成功；场景B 滤池穿透
const Sim = require('./sim.js');

function run(name, seed, controller) {
  const s = Sim.createSim(seed);
  while (!s.over) {
    controller(s);
    Sim.step(s, 1);
  }
  const ratio = (s.compliantTime / Sim.SIM_SECONDS * 100).toFixed(1);
  console.log(`\n== ${name} ==`);
  console.log(`达标率 ${ratio}%  清水库存 ${s.storage.toFixed(0)} m3  ` +
    `穿透次数 ${s.breakthroughs}  污泥 ${s.sludge.toFixed(0)}%  干涸 ${s.dryOut}`);
  console.log(`结果: ${s.success ? '成功' : '失败'}`);
  const kinds = {};
  for (const e of s.events) kinds[e.type] = (kinds[e.type] || 0) + 1;
  console.log('事件:', JSON.stringify(kinds));
  return s;
}

function summarize(s) {
  return {
    success: s.success,
    compliantRatio: +(s.compliantTime / Sim.SIM_SECONDS * 100).toFixed(1),
    finalStorage: +s.storage.toFixed(0),
    breakthroughs: s.breakthroughs,
    sludgePct: +s.sludge.toFixed(0),
    dryOut: s.dryOut,
    events: s.events,
  };
}

// 场景 A：稳健操作 —— 投药跟随最佳值，适度沉淀与滤速，及时反冲洗/排泥
const a = run('场景A 稳定运行', 20261114, (s) => {
  s.dose = Sim.optimalDose(s.rawNTU);
  s.sedTime = 22;
  s.filterSpeed = 5.5;
  if (s.headloss > 45) Sim.backwash(s);
  if (s.sludge > 80) Sim.desludge(s);
});

// 场景 B：滤池穿透 —— 滤速拉满且从不反冲洗
const b = run('场景B 滤池穿透', 20261114, (s) => {
  s.dose = Sim.optimalDose(s.rawNTU);
  s.sedTime = 18;
  s.filterSpeed = 12;
});

let ok = true;
if (!a.success) { console.error('FAIL: 场景A 应成功'); ok = false; }
if (a.breakthroughs !== 0) { console.error('FAIL: 场景A 不应发生穿透'); ok = false; }
if (b.breakthroughs < 1) { console.error('FAIL: 场景B 应发生滤池穿透'); ok = false; }
if (b.success) { console.error('FAIL: 场景B 不应成功'); ok = false; }
console.log(ok ? '\n全部断言通过' : '\n存在失败断言');

// 留存运行报告
require('fs').writeFileSync(
  require('path').join(__dirname, 'artifacts', 'scenario_report.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    stableRun: summarize(a),
    filterBreakthrough: summarize(b),
    assertionsPassed: ok,
  }, null, 2));

process.exit(ok ? 0 : 1);
