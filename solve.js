/* 实际完成一次抓取放置：
 * 1. 用解析 IK 把笛卡尔路径点转成关节目标；
 * 2. 用与页面相同的 stepJoints/checkCollision 逐步仿真（限速、连续）；
 * 3. 验证全程无碰撞、速度不超限、工件最终落入右夹具；
 * 4. 输出 demo_sequence.js 供页面回放。 */
const A = require('./arm.js');
const fs = require('fs');

// 二连杆 IK：给定夹爪尖端目标 T 与夹爪绝对朝向 a4，求 [肩,肘,腕]
function ik(T, a4) {
  const ux = Math.cos(a4), uy = Math.sin(a4);
  const w = { x: T.x - (A.LINKS[2] + A.GRIP_LEN) * ux, y: T.y - (A.LINKS[2] + A.GRIP_LEN) * uy };
  const dx = w.x - A.BASE.x, dy = w.y - A.BASE.y;
  const d = Math.hypot(dx, dy);
  const L1 = A.LINKS[0], L2 = A.LINKS[1];
  if (d > L1 + L2 - 1e-9) throw new Error('目标超出工作空间: ' + JSON.stringify(T));
  const cosE = A.clamp((d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1);
  let best = null;
  for (const s of [1, -1]) {
    const q1 = s * Math.acos(cosE);
    const q0 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(q1), L1 + L2 * Math.cos(q1));
    let q2 = a4 - q0 - q1;
    while (q2 > Math.PI) q2 -= 2 * Math.PI;
    while (q2 < -Math.PI) q2 += 2 * Math.PI;
    const p1y = A.BASE.y + L1 * Math.sin(q0);
    if (!best || p1y < best.p1y) best = { q: [q0, q1, q2], p1y };
  }
  return best.q;
}

const DOWN = Math.PI / 2; // 夹爪朝下
// 路径点：{tip, a4, fl, fr, action, label}
const WAYPOINTS = [
  { tip: { x: 330, y: 360 }, a4: DOWN, fl: 1, fr: 1, label: '移动到工件上方' },
  { tip: { x: 330, y: 395 }, a4: DOWN, fl: 1, fr: 1, label: '下降接近工件' },
  { tip: { x: 330, y: 437 }, a4: DOWN, fl: 1, fr: 1, label: '下降对准工件' },
  { tip: { x: 330, y: 437 }, a4: DOWN, fl: 0.05, fr: 0.05, action: 'grasp', label: '闭合夹爪抓取' },
  { tip: { x: 330, y: 350 }, a4: DOWN, fl: 0.05, fr: 0.05, label: '竖直抬升' },
  { tip: { x: 355, y: 350 }, a4: DOWN, fl: 0.05, fr: 0.05, label: '向隔墙左侧移动' },
  { tip: { x: 445, y: 350 }, a4: DOWN, fl: 0.05, fr: 0.05, label: '越过隔墙' },
  { tip: { x: 480, y: 395 }, a4: DOWN, fl: 0.05, fr: 0.05, label: '移动到夹具上方' },
  { tip: { x: 480, y: 437 }, a4: DOWN, fl: 0.05, fr: 0.05, label: '下降放置' },
  { tip: { x: 480, y: 437 }, a4: DOWN, fl: 1, fr: 1, action: 'release', label: '松开夹爪' },
  { tip: { x: 480, y: 390 }, a4: DOWN, fl: 1, fr: 1, label: '抬升撤离' },
];

const HOME = [-2.3, 2.2, 0.1, 0, 1, 1];

// 生成关节目标序列
const targets = WAYPOINTS.map(w => {
  const arm = ik(w.tip, w.a4);
  return { q: [arm[0], arm[1], arm[2], 0, w.fl, w.fr], action: w.action, label: w.label };
});

// 仿真验证
const dt = 1 / 120;
let cur = HOME.slice();
let carrying = false;
let piece = { x: A.PIECE_HOME.x, y: A.PIECE_HOME.y };
let maxSpeed = 0;
const recorded = [{ q: HOME.slice(), label: '初始姿态' }];

function stateNow() { return { q: cur, carrying: carrying, piece: piece }; }

for (const t of targets) {
  let steps = 0;
  while (!A.reached(cur, t.q)) {
    const r = A.stepJoints(cur, t.q, dt);
    cur = r.q;
    for (const v of r.speeds) maxSpeed = Math.max(maxSpeed, Math.abs(v));
    if (carrying) {
      const f = A.fk(cur);
      piece = { x: f.tip.x + Math.cos(f.a4) * 6, y: f.tip.y + Math.sin(f.a4) * 6 };
    }
    const hit = A.checkCollision(stateNow());
    if (hit) {
      console.error('碰撞失败 [' + t.label + ']: ' + hit);
      console.error('关节角:', cur.map(v => v.toFixed(3)).join(', '));
      process.exit(1);
    }
    if (++steps > 20000) { console.error('超时未到达: ' + t.label); process.exit(1); }
  }
  if (t.action === 'grasp') {
    const f = A.fk(cur);
    const d = Math.hypot(f.tip.x - piece.x, f.tip.y + 6 - piece.y);
    if (d > 16) { console.error('抓取失败，夹爪距工件 ' + d.toFixed(1) + 'px'); process.exit(1); }
    carrying = true;
  }
  if (t.action === 'release') {
    carrying = false;
    piece = { x: piece.x, y: A.DROP_ZONE.y }; // 落到夹具定位面
  }
  recorded.push({ q: cur.slice(), label: t.label });
}

// 判定成功：工件中心落在右夹具定位区
const ok = Math.abs(piece.x - A.DROP_ZONE.x) < 25 &&
           piece.x > A.FIXTURE_R.x && piece.x < A.FIXTURE_R.x + A.FIXTURE_R.w;
if (!ok) { console.error('放置失败，工件位置', piece); process.exit(1); }

console.log('抓取放置成功！');
console.log('最终工件位置: (' + piece.x.toFixed(1) + ', ' + piece.y.toFixed(1) + ') 目标: (' + A.DROP_ZONE.x + ', ' + A.DROP_ZONE.y + ')');
console.log('全程最大关节速度: ' + maxSpeed.toFixed(3) + ' rad/s (限速 ' + Math.min.apply(null, A.Q_VMAX) + ')');
console.log('姿态序列共 ' + recorded.length + ' 帧');

const out = '/* 由 solve.js 实际完成一次抓取放置后生成的姿态序列 */\n' +
  'const DEMO_SEQUENCE = ' + JSON.stringify(recorded.map(r => ({
    q: r.q.map(v => Math.round(v * 1000) / 1000), label: r.label,
  })), null, 1) + ';\n';
fs.writeFileSync(__dirname + '/demo_sequence.js', out);
console.log('已写出 demo_sequence.js');
