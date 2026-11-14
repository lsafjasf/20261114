/*
 * 以与页面完全相同的引擎、随机种子和求解流程，
 * 在 Node 中实际完成五组配色，输出每组逐次提交记录。
 */
const path = require('path');
const M = require(path.join(__dirname, '..', 'js', 'mixing.js'));
const S = require(path.join(__dirname, '..', 'js', 'solver.js'));

const SEED = 81;
const TOL = M.TOLERANCE;

const rng = M.mulberry32(SEED);
const rounds = [];
for (let i = 0; i < 5; i++) {
  const q = M.randomTarget(rng);
  const target = M.mix(q);
  const attempts = S.stagedAttempts(target.lab, TOL);
  rounds.push({ q, target, attempts });
}

console.log('容差: ΔE76 ≤ ' + TOL + '，每组最多 3 次提交\n');
let allHit = true;
const summary = rounds.map(function (rd, i) {
  const hitIndex = rd.attempts.findIndex(function (a) { return a.de <= TOL; });
  const used = hitIndex < 0 ? 3 : hitIndex + 1;
  const last = rd.attempts[used - 1];
  const hit = last.de <= TOL;
  allHit = allHit && hit;
  console.log('第 ' + (i + 1) + ' 组  目标 ' + rd.target.hex +
    '（真实配比 ' + rd.q.join('/') + '）');
  rd.attempts.slice(0, used).forEach(function (a, k) {
    const r = M.mix(a.amounts);
    console.log('  第' + (k + 1) + '次: C/M/Y/K = ' +
      a.amounts.map(String).join('/').padStart(15, ' ') +
      ' → ' + a.hex +
      '  H' + r.hsl[0].toFixed(0) + ' S' + r.hsl[1].toFixed(0) +
      ' L' + r.hsl[2].toFixed(0) +
      '  ΔE=' + a.de.toFixed(2) +
      (a.de <= TOL ? '  ✔ 命中' : ''));
  });
  console.log('  结果: ' + (hit ? '完成，用 ' + used + ' 次提交' : '未达标') + '\n');
  return {
    round: i + 1, target: rd.target.hex,
    amounts: last.amounts, final: last.hex,
    submits: used, de: last.de, hit: hit
  };
});

console.log('==== 汇总 ====');
console.table(summary.map(function (r) {
  return {
    组: r.round, 目标: r.target,
    'C/M/Y/K': r.amounts.join('/'), 最终色: r.final,
    提交次数: r.submits, 'ΔE': Number(r.de.toFixed(2)),
    结果: r.hit ? '完成' : '未达标'
  };
}));
console.log(allHit ? '五组全部命中，任务完成。' : '存在未命中分组。');
process.exit(allHit ? 0 : 1);
