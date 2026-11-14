// 无头验证：完整一局成功运输 + 一次安全急停
const fs = require('fs');

// DOM 桩件
const elemStub = () => ({
  value: '0', textContent: '', innerHTML: '', disabled: false,
  classList: { add() {}, remove() {}, toggle() {} },
  style: {}, appendChild() {}, scrollTop: 0, scrollHeight: 0,
  getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) }),
  onclick: null, oninput: null, onchange: null,
});
global.document = { getElementById: () => elemStub(), createElement: () => elemStub() };
global.window = {};
global.requestAnimationFrame = () => {};

eval(fs.readFileSync('main.js', 'utf8') +
  '\n;global.__api = { validateSchedule, createSim, stepSim, CFG };');
const { validateSchedule, createSim, stepSim, CFG } = global.__api;

const params = { interval: 60, dwell: 15, load: 1.0, seed: 20261114 };

// 1) 校验班次
const r = validateSchedule(params);
console.log('校验:', JSON.stringify(r));
if (!r.ok) { console.error('FAIL: 默认班次不可行'); process.exit(1); }

// 2) 完整跑一局，中途执行一次急停
const sim = createSim(params);
let estopPhase = 0;
while (!sim.over) {
  // 在 40s 时急停，55s 时解除（>0.8s）
  if (estopPhase === 0 && sim.t >= 40) { sim.emergency = true; estopPhase = 1; }
  if (estopPhase === 1 && sim.t >= 55) { sim.emergency = false; estopPhase = 2; }
  stepSim(sim, 0.05);
}
console.log('成功:', sim.success, '| 失败原因:', sim.fail,
  '| 用时:', sim.t.toFixed(1), '| 磨损:', sim.wear.toFixed(1),
  '| 交付:', sim.delivered, '| 急停完成:', sim.estopDone);
if (!sim.success) { console.error('FAIL: 运输未完成'); process.exit(1); }
if (!sim.estopDone) { console.error('FAIL: 急停目标未达成'); process.exit(1); }

// 3) 过短间隔应追尾
const bad = validateSchedule({ ...params, interval: 15 });
console.log('短间隔(15s)校验:', JSON.stringify(bad));
if (bad.ok) { console.error('FAIL: 过短间隔未被判定为危险'); process.exit(1); }

// 4) 过载应显著增加磨损
const heavy = validateSchedule({ ...params, load: 1.5 });
console.log('过载(1.5)校验:', JSON.stringify(heavy));
if (heavy.ok && heavy.wear <= r.wear) { console.error('FAIL: 过载未增加磨损'); process.exit(1); }

// 5) 自动排班搜索应找到可行间隔
let found = null;
for (let iv = 15; iv <= 120; iv += 5) {
  if (validateSchedule({ ...params, interval: iv }).ok) { found = iv; break; }
}
console.log('自动排班最小可行间隔:', found, 's');
if (!found) { console.error('FAIL: 无可行间隔'); process.exit(1); }

console.log('ALL TESTS PASSED');
