import assert from 'node:assert/strict';
import {
  GATES,
  OBJECT_COUNT,
  GATE_TRAVEL,
  DEFAULT_PARAMS,
  SOLVED_PARAMS,
  gatePhaseAt,
  gateHalfPhase,
  phaseDistanceToPulse,
  simulateRun,
  searchSolution,
  isGateOpenAt,
} from '../src/core.js';

function fmt(n) { return n.toFixed(4); }

function printRun(label, params) {
  const run = simulateRun(params);
  console.log(`\n=== ${label} ===`);
  params.forEach((p, i) => {
    console.log(
      `闸门${i + 1} (${GATES[i].n}脉冲) 强弱=${fmt(p.strength)} ` +
      `偏移=${fmt(p.offset)} 开门半宽=${fmt(gateHalfPhase(p.strength))}`,
    );
  });
  run.objects.forEach((o, k) => {
    const tag = o.neverRan ? '未投入(停机)' : o.passed ? '通过' : `撞门#${o.failedAt + 1}`;
    console.log(`物体 ${String(k + 1).padStart(2, ' ')}: ${tag}`);
  });
  console.log(`通过 ${run.passed}/${OBJECT_COUNT}，停机=${run.halted}`);
  return run;
}

// 1) 默认参数应当失败（否则题目没有调参意义）
const defaultRun = printRun('默认参数（预期失败）', DEFAULT_PARAMS);
assert.ok(defaultRun.passed < OBJECT_COUNT, '默认参数不应全部通过');
assert.ok(defaultRun.halted === true, '默认参数下应触发连续三次失败停机');

// 2) 网格搜索可行解
const search = searchSolution();
console.log('\n=== 网格搜索结果 ===');
search.params.forEach((p, i) => {
  console.log(`闸门${i + 1}: strength=${fmt(p.strength)} offset=${fmt(p.offset)}`);
});
assert.equal(search.run.allPassed, true, '搜索解必须让 12 个物体全部通过');

// 3) 验证内置 SOLVED_PARAMS
const solvedRun = printRun('内置求解参数（预期全部通过）', SOLVED_PARAMS);
assert.equal(solvedRun.allPassed, true, 'SOLVED_PARAMS 必须全部通过');
assert.equal(solvedRun.halted, false, '全部通过时不应停机');

// 4) 输出每个闸门在 12 个到达时刻的相位余量（证明有容错而非贴边）
console.log('\n=== 各闸门最差开门余量（相位，越大越稳）===');
SOLVED_PARAMS.forEach((p, gi) => {
  let worst = Infinity;
  for (let k = 0; k < OBJECT_COUNT; k += 1) {
    const arrive = k * 2 + GATE_TRAVEL[gi];
    const dist = phaseDistanceToPulse(gatePhaseAt(GATES[gi], p, arrive));
    worst = Math.min(worst, gateHalfPhase(p.strength) - dist);
  }
  console.log(`闸门${gi + 1} 最差余量=${fmt(worst)}`);
  assert.ok(worst > 0, `闸门${gi + 1} 必须有正余量`);
});

// 5) 冻结一致性：同一虚拟时刻，重复求值结果必须完全相同（暂停冻结的逻辑基础）
const t = 5.37;
const a = GATES.map((g, i) => isGateOpenAt(g, SOLVED_PARAMS[i], t));
const b = GATES.map((g, i) => isGateOpenAt(g, SOLVED_PARAMS[i], t));
assert.deepEqual(a, b);

console.log('\n全部断言通过 ✔');
