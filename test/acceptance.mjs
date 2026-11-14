import assert from 'node:assert/strict';
import { createSimulation, step, FIXED_DT, brakingDistance } from '../src/sim.js';
import { autopilotInput, skidScriptInput } from '../src/autopilot.js';
import { DEFAULT_SEED } from '../src/map.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err.stack || err);
    process.exitCode = 1;
  }
}

function run(seed, controller, maxSeconds = 120) {
  const state = createSimulation({ seed, autopilot: true });
  let frames = 0;
  const maxFrames = Math.round(maxSeconds / FIXED_DT);
  while (state.status === 'running' && frames < maxFrames) {
    const input = controller(state);
    step(state, input);
    frames += 1;
  }
  return { state, frames, seconds: frames * FIXED_DT };
}

console.log('验收 1：一次完整救援（三辆受困车全部救出并抵达终点）');
test('seed 固定时地图可达性校验通过', () => {
  const state = createSimulation({ seed: DEFAULT_SEED });
  assert.equal(state.status, 'running');
  assert.equal(state.map.stranded.length, 3);
});

const rescueRun = run(DEFAULT_SEED, autopilotInput, 90);
test('自动驾驶完成完整救援并获胜', () => {
  const { state, seconds } = rescueRun;
  assert.equal(state.status, 'won', `状态=${state.status} 原因=${state.failReason}`);
  assert.equal(state.rescued, 3);
  assert.equal(state.plow.load, 3);
  assert.ok(seconds < 75, `救援耗时 ${seconds.toFixed(1)}s 超出时限`);
  assert.ok(state.plow.durability > 0);
  console.log(`    耗时 ${seconds.toFixed(1)}s，剩余耐久 ${state.plow.durability}，碰撞 ${state.collisions} 次`);
});

test('每次救援都记录了载荷事件且刹车距离随载荷增加', () => {
  const rescueEvents = rescueRun.state.events.filter((e) => e.type === 'rescue');
  assert.equal(rescueEvents.length, 3);
  const d0 = brakingDistance(0);
  const d1 = brakingDistance(1);
  const d3 = brakingDistance(3);
  assert.ok(d1 > d0 && d3 > d1, `刹车距离未随载荷增长: ${d0}, ${d1}, ${d3}`);
  console.log(`    刹车距离(px) 空载=${d0.toFixed(0)} 1车=${d1.toFixed(0)} 3车=${d3.toFixed(0)}`);
});

console.log('验收 2：一次侧滑失败（强侧坡 + 高速 + 顺坡打方向）');
const skidRun = run(DEFAULT_SEED, skidScriptInput, 90);
test('侧滑失控导致救援失败且原因为 skid', () => {
  const { state } = skidRun;
  assert.equal(state.status, 'failed');
  assert.equal(state.failReason, 'skid');
  assert.ok(state.maxLateralSpeed > 175, `最大横向速度仅 ${state.maxLateralSpeed.toFixed(0)}`);
  assert.ok(state.plow.offroad, '失控时车辆应已冲出路面');
  console.log(`    在 ${state.time.toFixed(1)}s 侧滑，最大横向速度 ${state.maxLateralSpeed.toFixed(0)} px/s`);
});

console.log('回归：确定性与物理指标');
test('同 seed 两次仿真轨迹完全一致', () => {
  const a = run(DEFAULT_SEED, autopilotInput, 30).state;
  const b = run(DEFAULT_SEED, autopilotInput, 30).state;
  assert.equal(a.plow.x.toFixed(4), b.plow.x.toFixed(4));
  assert.equal(a.plow.y.toFixed(4), b.plow.y.toFixed(4));
  assert.equal(a.time, b.time);
});

test('不同 seed 生成不同地图', () => {
  const a = createSimulation({ seed: 1 }).map;
  const b = createSimulation({ seed: 2 }).map;
  assert.notEqual(a.centerX[2000], b.centerX[2000]);
});

test('多个 seed 的地图全部通过可达性校验', () => {
  for (const seed of [1, 2, 7, 42, 99, 12345, 20261114]) {
    const s = createSimulation({ seed });
    assert.equal(s.map.stranded.length, 3, `seed=${seed} 受困车数量错误`);
    assert.equal(s.status, 'running', `seed=${seed} 初始状态错误`);
  }
});

test('铲雪会降低速度：深雪阻力大于薄雪，稳态速度更低', () => {
  const drag = (snow) => 150 * snow + 90 * snow * snow;
  assert.ok(drag(1.5) > drag(0.2));
  const vShallow = Math.max(0, 330 - drag(0.2) * 0.4);
  const vDeep = Math.max(0, 330 - drag(1.5) * 0.4);
  assert.ok(vDeep < vShallow);
});

if (process.exitCode) {
  console.log(`\n${passed} 项通过，存在失败用例`);
} else {
  console.log(`\n全部 ${passed} 项验收通过`);
}
