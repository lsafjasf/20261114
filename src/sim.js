// 云台追踪模拟核心：浏览器与 Node 共用（无 DOM 依赖）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Sim = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TAU = Math.PI * 2;

  // 可调参数（测试会直接引用，改动需同步验证）
  var P = {
    inertia: 1.0,          // 云台转动惯量
    damping: 2.6,          // 粘性阻尼系数
    maxTorque: 9.0,        // 满档输入力矩
    safeSpeed: 2.2,        // 超过此角速度开始抖动 (rad/s)
    jitterGain: 0.16,      // 抖动幅度随超速增长的系数
    fovHalfX: 0.42,        // 取景框水平半角 (rad)
    fovHalfY: 0.30,        // 取景框垂直半角 (rad)
    camHeight: 1.6,        // 相机离地高度 (m)
    outGrace: 2.0,         // 目标出画宽容时间 (s)
    lockGrace: 0.3,        // 短暂出画不重置锁定计时 (s)
    winTime: 30.0,         // 连续锁定获胜时间 (s)
    fieldSize: 60,         // 草地边长 (m)
    targetSpeed: 6.0       // 目标移动速度 (m/s)
  };

  // 确定性 PRNG（固定轨迹用）
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 固定轨迹：环绕相机的闭环航点折线，目标匀速沿线走，
  // 到航点瞬间变向（转弯角 60°~150°）。seed 固定 => 轨迹固定。
  // 弦到原点距离过小会被拒绝，保证不会强制玩家超速抖动。
  function buildTrajectory(seed, waypointCount, minChord) {
    var rand = mulberry32(seed);
    var pts = [];
    var prevAngle = rand() * TAU;
    var guard = 0;
    while (pts.length < waypointCount && guard++ < 5000) {
      // 航点分布在半径 5~18m 的环带内，保证目标始终靠近相机
      var r = 5 + rand() * 13;
      // 相邻航点方位角大幅跳变 => 急转弯
      prevAngle += (0.9 + rand() * 1.6) * (rand() < 0.5 ? -1 : 1);
      var cand = [Math.cos(prevAngle) * r, Math.sin(prevAngle) * r];
      if (pts.length > 0 &&
          chordDistToOrigin(pts[pts.length - 1], cand) < minChord) {
        continue; // 该航点会让路径贴脸掠过相机，换一个
      }
      pts.push(cand);
    }
    pts.push(pts[0].slice()); // 闭环
    return pts;
  }

  function chordDistToOrigin(a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(a[0], a[1]);
    var k = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
    return Math.hypot(a[0] + dx * k, a[1] + dy * k);
  }

  // 生成并校验整条闭环（含收尾边），不满足最小净距就换种子
  var TRAJECTORY = (function () {
    for (var seed = 20261114; ; seed++) {
      var pts = buildTrajectory(seed, 36, 4.2);
      var ok = true;
      for (var i = 0; i < pts.length - 1; i++) {
        if (chordDistToOrigin(pts[i], pts[i + 1]) < 4.2) { ok = false; break; }
      }
      if (ok) return pts;
    }
  })();
  var TRAJ_TOTAL = (function () {
    var sum = 0;
    for (var i = 0; i < TRAJECTORY.length - 1; i++) {
      sum += Math.hypot(
        TRAJECTORY[i + 1][0] - TRAJECTORY[i][0],
        TRAJECTORY[i + 1][1] - TRAJECTORY[i][1]);
    }
    return sum;
  })();

  // 查询 t 时刻目标位置（匀速沿闭环循环）
  function targetPosAt(t) {
    var dist = (t * P.targetSpeed) % TRAJ_TOTAL;
    for (var i = 0; i < TRAJECTORY.length - 1; i++) {
      var a = TRAJECTORY[i], b = TRAJECTORY[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.hypot(dx, dy);
      if (dist <= len) {
        var k = dist / len;
        return [a[0] + dx * k, a[1] + dy * k];
      }
      dist -= len;
    }
    var end = TRAJECTORY[TRAJECTORY.length - 1];
    return [end[0], end[1]];
  }

  function createState() {
    return {
      t: 0,
      yaw: 0, pitch: 0,
      yawVel: 0, pitchVel: 0,
      jitterX: 0, jitterY: 0,
      outTimer: 0,
      lockTimer: 0,
      status: 'running',
      view: null
    };
  }

  // 目标相对相机的理想瞄准角（不含抖动）
  function targetAngles(state) {
    var pos = targetPosAt(state.t);
    var dx = pos[0], dz = pos[1], dy = -P.camHeight;
    var yawTo = Math.atan2(dx, dz);
    var flat = Math.hypot(dx, dz);
    var pitchTo = Math.atan2(dy, flat);
    return { yaw: yawTo, pitch: pitchTo, dist: Math.hypot(flat, dy) };
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 单步推进。input = {x, y} ∈ [-1,1]，x 控制 yaw，y 控制 pitch。
  function step(state, input, dt, randFn) {
    if (state.status !== 'running') return state;
    randFn = randFn || Math.random;

    var ix = clamp(input.x, -1, 1);
    var iy = clamp(input.y, -1, 1);

    // 惯性云台：力矩 -> 角加速度 -> 角速度 -> 角度（半隐式欧拉）
    var yawAcc = (ix * P.maxTorque - P.damping * state.yawVel) / P.inertia;
    var pitchAcc = (iy * P.maxTorque - P.damping * state.pitchVel) / P.inertia;
    state.yawVel += yawAcc * dt;
    state.pitchVel += pitchAcc * dt;
    state.yaw += state.yawVel * dt;
    state.pitch += state.pitchVel * dt;
    state.pitch = clamp(state.pitch, -1.2, 0.6);

    // 超速抖动：角速度越超限，瞄准点随机晃动越厉害
    var speed = Math.hypot(state.yawVel, state.pitchVel);
    var excess = Math.max(0, speed - P.safeSpeed);
    var amp = excess * P.jitterGain;
    state.jitterX = amp * (randFn() * 2 - 1);
    state.jitterY = amp * (randFn() * 2 - 1);

    var effYaw = state.yaw + state.jitterX;
    var effPitch = state.pitch + state.jitterY;

    var ang = targetAngles(state);
    var errYaw = wrapAngle(ang.yaw - effYaw);
    var errPitch = ang.pitch - effPitch;

    var nx = errYaw / P.fovHalfX;
    var ny = errPitch / P.fovHalfY;
    var inFrame = Math.abs(nx) <= 1 && Math.abs(ny) <= 1;

    if (inFrame) {
      state.outTimer = 0;
      state.lockTimer += dt;
    } else {
      state.outTimer += dt;
      if (state.outTimer > P.lockGrace) state.lockTimer = 0;
    }

    if (state.outTimer > P.outGrace) state.status = 'fail';
    if (state.lockTimer >= P.winTime) state.status = 'win';

    state.t += dt;
    state.view = {
      nx: nx, ny: ny, inFrame: inFrame,
      errYaw: errYaw, errPitch: errPitch,
      speed: speed, excess: excess,
      targetDist: ang.dist,
      lockRatio: Math.max(0, 1 - Math.max(Math.abs(nx), Math.abs(ny)))
    };
    return state;
  }

  return {
    P: P,
    TRAJECTORY: TRAJECTORY,
    targetPosAt: targetPosAt,
    targetAngles: targetAngles,
    createState: createState,
    step: step,
    wrapAngle: wrapAngle,
    clamp: clamp
  };
});
