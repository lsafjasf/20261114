const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Core = require('../js/core.js');

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  PASS ' + name); }
  catch (err) { failures.push(name); console.error('  FAIL ' + name + ' -> ' + err.message); }
}

console.log('# 1. 构造异常序列（至少三种异常）');
const series = Core.generateSeries();
const types = new Set(series.segments.map(s => s.type));
check('包含 4 类异常（短断点/尖峰/长断点/卡死）', () => {
  assert.ok(types.has('gap_short') && types.has('spike'));
  assert.ok(types.has('gap_long') && types.has('stuck'));
});
check('断点区间 raw 为 null', () => {
  series.segments.filter(s => s.type.startsWith('gap')).forEach(s => {
    for (let i = s.start; i <= s.end; i++) assert.strictEqual(series.points[i].raw, null);
  });
});
check('尖峰明显偏离 clean 曲线', () => {
  const spike = series.segments.find(s => s.type === 'spike');
  for (let i = spike.start; i <= spike.end; i++) {
    assert.ok(Math.abs(series.points[i].raw - series.points[i].clean) > 10);
  }
});
check('卡死区间数值恒定', () => {
  const stuck = series.segments.find(s => s.type === 'stuck');
  const vals = new Set();
  for (let i = stuck.start; i <= stuck.end; i++) vals.add(series.points[i].raw);
  assert.strictEqual(vals.size, 1);
});

console.log('# 2. 三种替换策略');
const segA = { ...series.segments[0], strategy: Core.STRATEGIES.LINEAR };
const linear = Core.applyStrategy(series.points, segA, Core.STRATEGIES.LINEAR);
check('线性插值：区间内单调且等于端点连线', () => {
  const before = series.points[segA.start - 1].raw;
  const after = series.points[segA.end + 1].raw;
  linear.filled.forEach(f => {
    const ratio = (f.index - (segA.start - 1)) / ((segA.end + 1) - (segA.start - 1));
    assert.ok(Math.abs(f.value - Math.round((before + (after - before) * ratio) * 10) / 10) < 0.02);
  });
});
const neighbor = Core.applyStrategy(series.points, segA, Core.STRATEGIES.NEIGHBOR);
check('邻居平均：每个填充值为前后有效点均值', () => {
  const before = series.points[segA.start - 1].raw;
  const after = series.points[segA.end + 1].raw;
  neighbor.filled.forEach(f => assert.strictEqual(f.value, Math.round((before + after) / 2 * 10) / 10));
});
const ff = Core.applyStrategy(series.points, segA, Core.STRATEGIES.FFORWARD);
check('保持前值：全部等于前一个有效值', () => {
  const before = series.points[segA.start - 1].raw;
  ff.filled.forEach(f => assert.strictEqual(f.value, before));
});

console.log('# 3. 全量修复与差异统计');
const repaired = Core.repairSeries(series.points, series.segments);
check('所有异常点均被替换，无非空未填项', () => {
  const pending = repaired.points.filter(p => p.status === 'pending' || p.status === 'unfilled');
  assert.strictEqual(pending.length, 0);
  assert.ok(repaired.summary.every(s => s.replaced > 0));
});
const diff = Core.computeDiff(repaired.points);
check('差异统计：替换点数等于异常区间点数之和', () => {
  const total = series.segments.reduce((n, s) => n + (s.end - s.start + 1), 0);
  assert.strictEqual(diff.replaced, total);
  assert.ok(diff.maxAbsDelta > 0);
});

console.log('# 4. CSV 导出验证');
const csv = Core.toCSV(repaired.points);
const outFile = path.join(__dirname, 'export-verify.csv');
fs.writeFileSync(outFile, csv);
const raw = fs.readFileSync(outFile, 'utf8').trim().split('\n');
check('CSV 表头与行数正确（120 行数据 + 表头）', () => {
  assert.strictEqual(raw[0], 'index,time,raw_c,repaired_c,status,flag,delta_c');
  assert.strictEqual(raw.length, series.points.length + 1);
});
check('CSV 中 replaced 行含 flag 且断点行 raw 为空', () => {
  const replacedRows = raw.slice(1).filter(line => line.includes(',replaced,'));
  assert.strictEqual(replacedRows.length, diff.replaced);
  const gapRow = raw[series.segments[0].start + 1].split(',');
  assert.strictEqual(gapRow[2], '');
  assert.strictEqual(gapRow[4], 'replaced');
});

if (failures.length) {
  console.error('\n' + failures.length + ' 项检查失败');
  process.exit(1);
}
console.log('\n全部检查通过，导出文件：' + outFile);
