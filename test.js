'use strict';
/* test.js — Node 无头测试：确定性、三点巡检完成、潮水封路失败、侧滑、碰撞 */
const SIM = require('./sim.js');
const { WORLD, createWorld, createState, step, autopilot } = SIM;

const SEED = 20261114;
const DT = 1 / 60;
let passed = 0, failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

function runMission(world, targetPicker, maxT) {
  const state = createState(world);
  const trail = [];
  while (state.status === 'running' && state.time < maxT) {
    const target = targetPicker(state);
    const input = target ? autopilot(state, target) : { turn: 0, throttle: 0 };
    step(world, state, input, DT);
    trail.push({ x: state.craft.x, y: state.craft.y });
  }
  return { state, trail };
}

/* 1. 固定 seed → 世界完全确定 */
{
  const w1 = createWorld(SEED), w2 = createWorld(SEED);
  check('固定 seed 生成确定性世界', JSON.stringify(w1) === JSON.stringify(w2));
}

const world = createWorld(SEED);
console.log(`巡检点: ${world.points.map((p) => `(${p.x | 0},${p.y | 0})`).join(' ')}`);
console.log(`残桩数: ${world.stumps.length}`);

/* 2. 潮位窗口内完成三点巡检并撤出 */
{
  let idx = 0;
  const exit = { x: WORLD.W / 2, y: WORLD.exitY + 40 };
  const { state } = runMission(world, (s) => {
    while (idx < world.points.length && s.inspections[idx].done) idx++;
    return idx < world.points.length ? world.points[idx] : exit;
  }, 300);
  console.log(`  完成用时 ${state.time.toFixed(1)}s, 底裙 ${state.skirt.toFixed(0)}%, 潮线 y=${state.tideY.toFixed(0)}`);
  check('三点全部巡检', state.doneCount === 3, `done=${state.doneCount}`);
  check('潮位窗口内撤出（胜利）', state.status === 'won', `status=${state.status}`);
  check('胜利时潮线未封路', state.tideY < WORLD.exitY, `tideY=${state.tideY | 0}`);
}

/* 3. 潮水封路失败：巡检一点后滞留北侧，被回流潮水追上 */
{
  const farNorth = { x: WORLD.W / 2, y: 320 };
  let phase = 0;
  const { state } = runMission(world, (s) => {
    if (phase === 0) {
      if (s.inspections[0].done) { phase = 1; return farNorth; }
      return world.points[0];
    }
    return farNorth; // 滞留泥滩深处，错过窗口
  }, 300);
  console.log(`  失败于 t=${state.time.toFixed(1)}s, 原因=${state.failReason}, 潮线 y=${state.tideY.toFixed(0)}, 艇 y=${state.craft.y.toFixed(0)}`);
  check('潮水封路导致失败', state.status === 'failed' && state.failReason === 'tide');
  check('失败前未完成撤离', state.doneCount < 3 || state.craft.y < WORLD.exitY);
}

/* 4. 加速转向产生侧滑：速度矢量滞后于艇首方向 */
{
  const s = createState(world);
  for (let i = 0; i < 120; i++) step(world, s, { turn: 0, throttle: 1 }, DT); // 全速直行
  const before = Math.atan2(s.craft.vy, s.craft.vx);
  for (let i = 0; i < 30; i++) step(world, s, { turn: 1, throttle: 1 }, DT); // 急转+加速
  const velDir = Math.atan2(s.craft.vy, s.craft.vx);
  const slip = Math.abs(SIM.wrapAngle(velDir - s.craft.heading));
  console.log(`  侧滑角 ${(slip * 180 / Math.PI).toFixed(1)}°`);
  check('加速转向产生侧滑', slip > 0.12, `slip=${slip.toFixed(3)}rad`);
  check('转向确实改变了航向', Math.abs(SIM.wrapAngle(s.craft.heading - before)) > 0.3);
}

/* 5. 撞上残桩损坏底裙 */
{
  const s = createState(world);
  const stump = world.stumps[0];
  s.craft.x = stump.x - 120; s.craft.y = stump.y; s.craft.heading = 0;
  let hit = false;
  for (let i = 0; i < 600 && s.status === 'running'; i++) {
    step(world, s, { turn: 0, throttle: 1 }, DT);
    if (s.events.some((e) => e.type === 'hit')) hit = true;
  }
  check('撞桩产生损坏事件', hit);
  check('底裙完好度下降', s.skirt < WORLD.skirtMax, `skirt=${s.skirt}`);
}

/* 6. 泥地阻力随时间变化 */
{
  const s = createState(world);
  const drags = new Set();
  for (let i = 0; i < 600; i++) { s.time = i * 0.1; drags.add(SIM.mudDrag(s).toFixed(3)); }
  check('泥地阻力随时间变化', drags.size > 20, `distinct=${drags.size}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
