/* 机械手共享逻辑：正运动学、碰撞检测、关节限速。浏览器与 Node 通用。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ArmCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LINKS = [150, 120, 80];     // 肩、肘、腕连杆长度
  const BASE = { x: 260, y: 440 };  // 基座位置
  const GRIP_LEN = 18;              // 腕末端到夹爪尖端
  const LINK_R = 5;                 // 连杆半径（碰撞厚度）
  const PIECE_R = 10;               // 工件半径

  // 关节限位（弧度）：肩、肘、腕、夹爪旋转、左指、右指
  const Q_MIN = [-2.6, -2.4, -2.4, -1.5, 0, 0];
  const Q_MAX = [ 0.9,  2.4,  2.4,  1.5, 1, 1];
  // 关节最大速度（rad/s，手指为 1/s）
  const Q_VMAX = [1.8, 1.8, 1.8, 2.0, 2.5, 2.5];

  // 场景障碍：中间隔墙（必须翻越），左右托盘/夹具台面
  const WALL = { x: 380, y: 390, w: 40, h: 85 };
  const PALLET_L = { x: 300, y: 455, w: 60, h: 20 };
  const FIXTURE_R = { x: 450, y: 455, w: 60, h: 20 };
  const GROUND_Y = 475;
  const PIECE_HOME = { x: 330, y: 445 };  // 工件初始位置（左托盘上）
  const DROP_ZONE = { x: 480, y: 445 };   // 右夹具放置点

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // 正运动学：q = [肩, 肘, 腕, 夹爪旋转, 左指, 右指]
  function fk(q) {
    const a1 = q[0];
    const a2 = a1 + q[1];
    const a3 = a2 + q[2];
    const a4 = a3 + q[3];
    const p0 = { x: BASE.x, y: BASE.y };
    const p1 = { x: p0.x + LINKS[0] * Math.cos(a1), y: p0.y + LINKS[0] * Math.sin(a1) };
    const p2 = { x: p1.x + LINKS[1] * Math.cos(a2), y: p1.y + LINKS[1] * Math.sin(a2) };
    const p3 = { x: p2.x + LINKS[2] * Math.cos(a3), y: p2.y + LINKS[2] * Math.sin(a3) };
    const tip = { x: p3.x + GRIP_LEN * Math.cos(a4), y: p3.y + GRIP_LEN * Math.sin(a4) };
    // 手指：垂直于夹爪方向张开，开口由 q[4]/q[5] 控制
    const nx = -Math.sin(a4), ny = Math.cos(a4);
    const openL = 4 + q[4] * 12, openR = 4 + q[5] * 12;
    const fL = { x: tip.x + nx * openL, y: tip.y + ny * openL };
    const fR = { x: tip.x - nx * openR, y: tip.y - ny * openR };
    const fL2 = { x: fL.x + Math.cos(a4) * 12, y: fL.y + Math.sin(a4) * 12 };
    const fR2 = { x: fR.x + Math.cos(a4) * 12, y: fR.y + Math.sin(a4) * 12 };
    return { p0, p1, p2, p3, tip, a1, a2, a3, a4, fL, fR, fL2, fR2 };
  }

  function segRectHit(a, b, r, pad) {
    // 采样法：线段上取点，检查是否进入扩张后的矩形
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) return true;
    }
    return false;
  }

  function circleRectHit(c, rad, r) {
    const cx = clamp(c.x, r.x, r.x + r.w);
    const cy = clamp(c.y, r.y, r.y + r.h);
    return Math.hypot(c.x - cx, c.y - cy) < rad;
  }

  /* 碰撞检测。返回碰撞描述字符串或 null。
   * state: { q, carrying, piece }  piece 为工件当前圆心（被携带时随夹爪走）
   * 规则：臂杆不能碰隔墙、托盘、夹具与地面；被携带的工件不能碰隔墙与地面。 */
  function checkCollision(state) {
    const f = fk(state.q);
    const armSegs = [
      [f.p0, f.p1, '肩臂'], [f.p1, f.p2, '肘臂'], [f.p2, f.p3, '腕臂'],
      [f.p3, f.tip, '夹爪'], [f.fL, f.fL2, '左指'], [f.fR, f.fR2, '右指'],
    ];
    const solids = [
      [WALL, '隔墙'], [PALLET_L, '左托盘'], [FIXTURE_R, '右夹具'],
    ];
    for (const seg of armSegs) {
      const a = seg[0], b = seg[1], name = seg[2];
      for (const solid of solids) {
        const rect = solid[0], rname = solid[1];
        // 夹爪与手指允许贴近台面（抓取/放置需要），只严格检测隔墙
        const isGrip = name === '夹爪' || name === '左指' || name === '右指';
        if (isGrip && rname !== '隔墙') continue;
        if (segRectHit(a, b, rect, LINK_R)) return name + ' 碰到 ' + rname;
      }
      if (Math.max(a.y, b.y) > GROUND_Y - LINK_R) return name + ' 碰到地面';
    }
    if (state.carrying && state.piece) {
      if (circleRectHit(state.piece, PIECE_R, WALL)) return '工件 碰到 隔墙';
      if (state.piece.y + PIECE_R > GROUND_Y) return '工件 碰到 地面';
    }
    return null;
  }

  /* 单步积分：当前角向目标角逼近，限速。返回 {q, speeds, tripped}
   * tripped：需求速度超过限速 1.6 倍 -> 触发保护 */
  function stepJoints(cur, target, dt) {
    const GAIN = 6, speeds = [], q = [];
    let tripped = false;
    for (let i = 0; i < 6; i++) {
      const want = (target[i] - cur[i]) * GAIN;
      if (Math.abs(want) > Q_VMAX[i] * 1.6) tripped = true;
      const v = clamp(want, -Q_VMAX[i], Q_VMAX[i]);
      speeds.push(v);
      q.push(clamp(cur[i] + v * dt, Q_MIN[i], Q_MAX[i]));
    }
    return { q, speeds, tripped };
  }

  function reached(cur, target, tol) {
    tol = tol || 0.02;
    for (let i = 0; i < 6; i++) if (Math.abs(cur[i] - target[i]) > tol) return false;
    return true;
  }

  return {
    LINKS: LINKS, BASE: BASE, GRIP_LEN: GRIP_LEN, LINK_R: LINK_R, PIECE_R: PIECE_R,
    Q_MIN: Q_MIN, Q_MAX: Q_MAX, Q_VMAX: Q_VMAX,
    WALL: WALL, PALLET_L: PALLET_L, FIXTURE_R: FIXTURE_R, GROUND_Y: GROUND_Y,
    PIECE_HOME: PIECE_HOME, DROP_ZONE: DROP_ZONE,
    clamp: clamp, fk: fk, checkCollision: checkCollision,
    stepJoints: stepJoints, reached: reached,
  };
});
