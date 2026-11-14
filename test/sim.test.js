// 自动化验证：过冲、抖动、完整 30s 追踪、丢失失败。
// 运行: node --test test/
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../src/sim.js');

const DT = 1 / 120;

// 带预判的 PD 自动驾驶：模拟看到轨迹提前转向的玩家
function autopilotInput(state) {
  const ang = Sim.targetAngles({ t: state.t + 0.18 });
  const errYaw = Sim.wrapAngle(ang.yaw - state.yaw);
  const errPitch = ang.pitch - state.pitch;
  return {
    x: Sim.clamp(5.0 * errYaw - 2.0 * state.yawVel, -1, 1),
    y: Sim.clamp(5.0 * errPitch - 2.0 * state.pitchVel, -1, 1)
  };
}

test('过冲：PD 控制到固定角度，超调有限且能稳定', () => {
  const s = Sim.createState();
  const target = 0.8; // rad
  let maxYaw = -Infinity;
  let settleTime = null;
  for (let i = 0; i < 120 * 6; i++) {
    const err = Sim.wrapAngle(target - s.yaw);
    const input = { x: Sim.clamp(4.0 * err - 1.8 * s.yawVel, -1, 1), y: 0 };
    Sim.step(s, input, DT, () => 0.5);
    maxYaw = Math.max(maxYaw, s.yaw);
    if (settleTime === null && s.t > 0.3 &&
        Math.abs(Sim.wrapAngle(target - s.yaw)) < 0.02 &&
        Math.abs(s.yawVel) < 0.05) {
      settleTime = s.t;
    }
  }
  const overshoot = (maxYaw - target) / target;
  assert.ok(maxYaw > target * 0.99, '应能到达目标角度');
  assert.ok(overshoot < 0.15, `超调应 < 15%，实际 ${(overshoot * 100).toFixed(1)}%`);
  assert.ok(settleTime !== null && settleTime < 2.5,
    `应在 2.5s 内稳定，实际 ${settleTime}`);
});

test('惯性：满力矩短推后松手，云台会继续滑行（过冲来源）', () => {
  const s = Sim.createState();
  for (let i = 0; i < 0.3 / DT; i++) Sim.step(s, { x: 1, y: 0 }, DT, () => 0.5);
  const yawAtRelease = s.yaw;
  for (let i = 0; i < 3 / DT; i++) Sim.step(s, { x: 0, y: 0 }, DT, () => 0.5);
  const coast = s.yaw - yawAtRelease;
  assert.ok(coast > 0.05, `松手后应因惯性继续滑行，实际 ${coast.toFixed(3)} rad`);
  // 阻尼应最终让它停下
  assert.ok(Math.abs(s.yawVel) < 0.01, '阻尼应使云台最终停稳');
});

test('抖动：持续满档输入会超速并产生瞄准抖动', () => {
  const s = Sim.createState();
  let sawJitter = false;
  for (let i = 0; i < 3 / DT; i++) {
    Sim.step(s, { x: 1, y: 0 }, DT, Math.random);
    if (s.view.excess > 0 && Math.abs(s.jitterX) > 1e-4) sawJitter = true;
  }
  assert.ok(s.view.speed > Sim.P.safeSpeed, '满档持续输入应超过安全转速');
  assert.ok(sawJitter, '超速时应出现抖动');
});

test('追踪：自动驾驶在固定轨迹上连续锁定 30s 获胜', () => {
  const s = Sim.createState();
  let maxAbsNx = 0, maxAbsNy = 0, maxSpeed = 0;
  let jitterSteps = 0, totalSteps = 0;
  while (s.status === 'running' && s.t < 45) {
    Sim.step(s, autopilotInput(s), DT, Math.random);
    totalSteps++;
    if (s.t > 3) { // 忽略开局捕获阶段
      maxAbsNx = Math.max(maxAbsNx, Math.abs(s.view.nx));
      maxAbsNy = Math.max(maxAbsNy, Math.abs(s.view.ny));
      maxSpeed = Math.max(maxSpeed, s.view.speed);
      if (s.view.excess > 0) jitterSteps++;
    }
  }
  assert.strictEqual(s.status, 'win',
    `应获胜，实际 ${s.status} (t=${s.t.toFixed(1)}s, lock=${s.lockTimer.toFixed(1)}s)`);
  assert.ok(s.lockTimer >= Sim.P.winTime, '锁定时长应达到获胜线');
  // 追踪品质：捕获后目标不应远离取景框边缘
  assert.ok(maxAbsNx <= 1.0 && maxAbsNy <= 1.0,
    `捕获后目标不应出画 (nx=${maxAbsNx.toFixed(2)}, ny=${maxAbsNy.toFixed(2)})`);
  // 自动驾驶不应长期靠超速抖动硬追
  assert.ok(jitterSteps / totalSteps < 0.3,
    `抖动时间占比应 < 30%，实际 ${(100 * jitterSteps / totalSteps).toFixed(1)}%`);
  console.log(`  [追踪] 获胜用时 ${s.t.toFixed(1)}s, 峰值转速 ${maxSpeed.toFixed(2)} rad/s, ` +
    `捕获后最大偏差 nx=${maxAbsNx.toFixed(2)} ny=${maxAbsNy.toFixed(2)}`);
});

test('失败：完全不操作，目标出画超过宽容时间即失败', () => {
  const s = Sim.createState();
  while (s.status === 'running' && s.t < 30) {
    Sim.step(s, { x: 0, y: 0 }, DT, () => 0.5);
  }
  assert.strictEqual(s.status, 'fail', '不操作应失败');
  assert.ok(s.outTimer > Sim.P.outGrace, '失败时出画时间应超过宽容期');
});

test('固定轨迹：同一时刻位置确定且可复现', () => {
  const a = Sim.targetPosAt(5.5);
  const b = Sim.targetPosAt(5.5);
  assert.deepStrictEqual(a, b);
  // 匀速：用小步长累计弧长，跨航点也不影响
  let arc = 0;
  let prev = Sim.targetPosAt(0);
  for (let t = 0.02; t <= 10; t += 0.02) {
    const p = Sim.targetPosAt(t);
    arc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  // 采样在航点处会轻微截弯，放 0.5% 容差
  assert.ok(Math.abs(arc - 10 * Sim.P.targetSpeed) < 10 * Sim.P.targetSpeed * 0.005,
    `目标应匀速移动，弧长 ${arc.toFixed(3)}`);
  // 变向：轨迹应存在急转弯
  let maxTurn = 0;
  for (let t = 0; t < 60; t += 0.05) {
    const p0 = Sim.targetPosAt(t), p1 = Sim.targetPosAt(t + 0.05),
      p2 = Sim.targetPosAt(t + 0.1);
    const h1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const h2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    maxTurn = Math.max(maxTurn, Math.abs(Sim.wrapAngle(h2 - h1)));
  }
  assert.ok(maxTurn > 0.8, `应存在急转弯，最大转弯角 ${maxTurn.toFixed(2)} rad`);
});
