/* Node 自测：seed 确定性、10 张走纸、重置一致性、失败判定。 */
"use strict";
var assert = require("assert");
var L = require("../js/logic.js");

// 1. 固定 seed 漂移趋势确定且逐张放大
var t1 = L.buildDriftTrend(L.DEFAULT_SEED);
var t2 = L.buildDriftTrend(L.DEFAULT_SEED);
assert.deepStrictEqual(t1, t2, "同一 seed 趋势必须一致");
assert.strictEqual(t1.length, L.SHEETS_PER_JOB, "趋势长度 = 10");
var mag = t1.map(function (d) { return Math.hypot(d.x, d.y); });
assert.ok(mag[9] > mag[0], "边缘错位应逐渐放大: " + mag[0] + " -> " + mag[9]);

// 2. 实际跑 10 张：补偿跟随趋势则全部合格
var job = L.createJob(L.DEFAULT_SEED);
for (var i = 0; i < L.SHEETS_PER_JOB; i++) {
  var d = job.trend[job.index];
  job.printNext(d.x, d.y, 55);
}
assert.strictEqual(job.history.length, 10, "必须跑满 10 张");
assert.strictEqual(job.good, 10, "完全补偿应 10 张全良: " + job.good);
assert.strictEqual(job.waste, 0);
assert.ok(job.done && !job.failed, "10 张合格订单应成功");
assert.strictEqual(job.printNext(0, 0, 55), null, "结束后不能再走纸");

// 3. 重置：同一 seed 重建，趋势与整批结果完全一致
var jobA = L.createJob(L.DEFAULT_SEED);
var jobB = L.createJob(L.DEFAULT_SEED);
for (var j = 0; j < 10; j++) {
  var a = jobA.printNext(0.1, -0.1, 60);
  var b = jobB.printNext(0.1, -0.1, 60);
  assert.deepStrictEqual(a, b, "重置后第 " + (j + 1) + " 张结果必须一致");
}
assert.strictEqual(jobA.good, jobB.good);
assert.strictEqual(jobA.failed, jobB.failed);

// 4. 失败判定 a：力度过大起皱 -> 废纸超限 -> 订单失败
var jobW = L.createJob(L.DEFAULT_SEED);
var wrinkleSheets = 0;
while (!jobW.done) {
  var s = jobW.printNext(0, 0, 95); // 力度 95 > 85 必起皱
  assert.ok(s.result.wrinkled, "力度 95 必须起皱");
  assert.ok(!s.result.pass);
  wrinkleSheets++;
}
assert.strictEqual(wrinkleSheets, L.MAX_WASTE + 1, "废纸超上限即停机: " + wrinkleSheets);
assert.ok(jobW.failed, "废纸超限必须判失败");

// 5. 失败判定 b：零补偿超差累计 -> 良品不足判失败
var jobZ = L.createJob(L.DEFAULT_SEED);
while (!jobZ.done) jobZ.printNext(0, 0, 55);
assert.ok(jobZ.done);
assert.ok(jobZ.waste > 0, "零补偿应产生废纸");
assert.ok(jobZ.failed, "零补偿良品不足必须判失败");

// 6. 力度过低收紧容差
var starve = L.evaluateSheet({ x: 0.12, y: 0 }, 0, 0, 20, null);
assert.ok(starve.starved && starve.tolerance === L.TIGHT_TOLERANCE);
assert.ok(!starve.pass, "0.12mm 在收紧容差 0.10 下应不合格");
var normal = L.evaluateSheet({ x: 0.12, y: 0 }, 0, 0, 55, null);
assert.ok(normal.pass, "0.12mm 在正常容差 0.15 下应合格");

console.log("全部测试通过");
console.log("趋势(末张): x=" + t1[9].x.toFixed(3) + " y=" + t1[9].y.toFixed(3));
console.log("零补偿批次: 良品 " + jobZ.good + " 废纸 " + jobZ.waste + " failed=" + jobZ.failed);
