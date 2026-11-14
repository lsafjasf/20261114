// 排程逻辑验证：node verify/verify.js
import {
  CONFIG,
  STARS,
  simulate,
  goodSchedule,
  badSchedule,
  observableWindows,
} from '../src/engine.js';

let passedCount = 0;
let failedCount = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passedCount += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failedCount += 1;
    console.error(`  FAIL  ${name} ${detail}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

// 1. 可观测窗口计算：月光段应被切分
section('窗口与环境约束');
const w1 = observableWindows(STARS[0]);
check(
  '星1 窗口被月光段 4-8 切成两段',
  w1.length === 2 && w1[0].end === 4 && w1[1].start === 8,
  JSON.stringify(w1)
);
const w2 = observableWindows(STARS[1]);
check(
  '星2 窗口被月光段 26-32 切成两段',
  w2.length === 2 && w2[0].end === 26 && w2[1].start === 32,
  JSON.stringify(w2)
);
const w3 = observableWindows(STARS[2]);
check(
  '星3 窗口被月光段 50-54 切成两段',
  w3.length === 2 && w3[0].end === 50 && w3[1].start === 54,
  JSON.stringify(w3)
);

// 2. 可行排程通过
section('可行排程（应通过）');
const good = simulate(goodSchedule());
check('可行排程 passed === true', good.passed === true, JSON.stringify(good.issues));
check(
  '三颗星均达到所需有效曝光',
  STARS.every((s) => (good.validExposure[s.id] || 0) >= s.required),
  JSON.stringify(good.validExposure)
);
check('无错过窗口记录', good.missed.length === 0, JSON.stringify(good.missed));
const lastEnd = Math.max(...goodSchedule().map((a) => a.end));
check(`最后动作 t=${lastEnd} 未超总时长 ${CONFIG.sessionEnd}`, lastEnd <= CONFIG.sessionEnd);

// 3. 失败排程：错过窗口
section('失败排程（应错过窗口）');
const bad = simulate(badSchedule());
check('失败排程 passed === false', bad.passed === false);
check('三颗星全部错过窗口', bad.missed.length === 3, JSON.stringify(bad.missed));
const missedIds = bad.missed.map((m) => m.starId).sort();
check('错过名单为星1/星2/星3', JSON.stringify(missedIds) === '[1,2,3]');
const missedEvents = bad.events.filter((e) => e.type === 'missed');
check('错过窗口事件数 = 3', missedEvents.length === 3);
check(
  '错过事件标注了窗口关闭时刻',
  missedEvents.every((e, i) => e.time === STARS[i].set)
);

// 4. 月光作废的曝光分钟数
section('月光与地平线约束');
check(
  '星1 月光段 4-8 使 4 分钟曝光作废（有效 4/6）',
  (bad.validExposure[1] || 0) === 4,
  JSON.stringify(bad.validExposure)
);
check(
  '星2 月光段 26-32 使 6 分钟曝光作废（有效 7/8）',
  (bad.validExposure[2] || 0) === 7
);
check(
  '星3 月光段 50-54 使 4 分钟曝光作废（有效 4/5）',
  (bad.validExposure[3] || 0) === 4
);

// 5. 地平线：星3 未升起（t<38）时曝光
section('地平线约束');
const below = simulate([
  { kind: 'slew', starId: 3, start: 30, end: 32 },
  { kind: 'filter', filter: 'B', start: 32, end: 33 },
  { kind: 'expose', starId: 3, start: 33, end: 39 }, // 33-38 低于地平线
]);
check('星3 未升起时曝光被判无效段', below.issues.some((i) => i.includes('低于地平线')));
check('星3 仅 38-39 一分钟有效', (below.validExposure[3] || 0) === 1);
check('星3 仍被记为错过窗口', below.missed.some((m) => m.starId === 3));

// 6. 指向/色片不匹配
section('指向与色片前置条件');
const noPrep = simulate([
  { kind: 'expose', starId: 1, start: 10, end: 16 },
]);
check('未转台未换片直接曝光被拒', noPrep.issues.some((i) => i.includes('曝光无效')));

const wrongFilter = simulate([
  { kind: 'slew', starId: 1, start: 0, end: 2 },
  { kind: 'filter', filter: 'B', start: 2, end: 3 },
  { kind: 'expose', starId: 1, start: 9, end: 15 },
]);
check('色片不匹配被拒', wrongFilter.issues.some((i) => i.includes('色片')));

// 7. 动作重叠与超时
section('排程纪律');
const overlap = simulate([
  { kind: 'slew', starId: 1, start: 0, end: 2 },
  { kind: 'filter', filter: 'R', start: 1, end: 2 },
]);
check('重叠动作被拦截', overlap.issues.some((i) => i.includes('重叠')));

const overtime = simulate([
  { kind: 'slew', starId: 1, start: 55, end: 57 },
  { kind: 'filter', filter: 'R', start: 57, end: 58 },
  { kind: 'expose', starId: 1, start: 58, end: 64 },
]);
check('超出夜结束的动作被拦截', overtime.issues.some((i) => i.includes('超出')));
check('超时排程不通过', overtime.passed === false);

// 汇总
section('汇总');
console.log(`通过 ${passedCount} 项，失败 ${failedCount} 项`);
if (failedCount > 0) process.exit(1);
console.log('全部验证通过 ✅');
