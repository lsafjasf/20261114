/* 验证脚本：用内置样例实际检验 去重 / 补缺 / 异常标记。运行：node verify.js */
"use strict";

const SAMPLE_CSV = require("./sample-data.js");
const { clean } = require("./clean.js");

let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}

const { points, report } = clean(SAMPLE_CSV);
const HOUR = 3600 * 1000;
const START = Date.UTC(2026, 10, 1, 0, 0, 0);
const at = (h) => points.find((p) => p.t === START + h * HOUR);

// --- 基本结构 ---
check("输出 72 个整点记录", points.length === 72, `实际 ${points.length}`);
check(
  "时间戳严格升序（乱序已修复）",
  points.every((p, i) => i === 0 || p.t > points[i - 1].t)
);
check("整点间隔连续无缺口",
  points.every((p, i) => i === 0 || p.t - points[i - 1].t === HOUR));

// --- 去重 ---
check("剔除 2 条重复记录", report.duplicatesRemoved.length === 2,
  `实际 ${report.duplicatesRemoved.length}`);
const csvLines = SAMPLE_CSV.split("\n").filter((l) => l.trim());
const dupRowsInFile = [];
const seen = {};
csvLines.forEach((line, idx) => {
  const ts = line.split(",")[0].trim();
  if (idx === 0) return;
  if (seen[ts]) dupRowsInFile.push({ kept: seen[ts], removed: idx + 1 });
  else seen[ts] = idx + 1;
});
check(
  "去重行号与原始文件一致",
  report.duplicatesRemoved.every((d, i) =>
    d.keptRow === dupRowsInFile[i].kept && d.removedRow === dupRowsInFile[i].removed),
  JSON.stringify({ got: report.duplicatesRemoved, expect: dupRowsInFile })
);

// --- 补缺 ---
check("补齐 3 处缺失值", report.missingFilled.length === 3,
  `实际 ${report.missingFilled.length}`);
const f10 = at(10), f33 = at(33), f48 = at(48);
check("第 10 小时 station_a 标记为插值", f10 && f10.aFilled === true);
check("第 33 小时 station_b 标记为插值", f33 && f33.bFilled === true);
check("第 48 小时 station_a 标记为插值", f48 && f48.aFilled === true);
const expectA10 = Math.round(((at(9).a + at(11).a) / 2) * 1000) / 1000;
// 注意：at(9)/at(11) 自身非插值点，线性插值应等于两点均值（等间隔）
check("第 10 小时插值等于相邻均值", Math.abs(f10.a - expectA10) < 1e-9,
  `got ${f10.a}, expect ${expectA10}`);
check("插值点数值在合理潮位范围 (0~5m)",
  [f10.a, f33.b, f48.a].every((v) => v > 0 && v < 5));

// --- 异常标记 ---
check("标记 2 个异常点", report.anomalies.length === 2,
  `实际 ${report.anomalies.length}: ${JSON.stringify(report.anomalies)}`);
const anomA = report.anomalies.find((x) => x.station === "station_a");
const anomB = report.anomalies.find((x) => x.station === "station_b");
check("A 站尖峰 9.870 被标记", anomA && Math.abs(anomA.value - 9.87) < 1e-9);
check("B 站跌落 -3.450 被标记", anomB && Math.abs(anomB.value + 3.45) < 1e-9);
check("异常点时间正确（第 15 / 60 小时）",
  anomA && anomA.t === START + 15 * HOUR && anomB && anomB.t === START + 60 * HOUR);
check("异常点带原始行号且行号在文件范围内",
  report.anomalies.every((x) => x.row > 1 && x.row <= csvLines.length));
const lineOf = (row) => csvLines[row - 1];
check("异常点行号指向的原始行数值一致",
  anomA && lineOf(anomA.row).includes("9.870") &&
  anomB && lineOf(anomB.row).includes("-3.450"),
  `A行:${lineOf(anomA && anomA.row)} B行:${lineOf(anomB && anomB.row)}`);
check("插值点未被误标为异常",
  ![f10, f33, f48].some((p) => p.aAnomaly || p.bAnomaly));

console.log(failures === 0 ? "\n全部验证通过 ✔" : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
