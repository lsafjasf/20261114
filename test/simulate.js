// 自动航行仿真测试：
//  1) 自动舵手在固定风场中依次通过 3 个浮标完成三段航程
//  2) 空压舱强风横风 => 翻覆失败
//  3) 触礁 => 扣船体
// 运行: node test/simulate.js
'use strict';
const P = require('../js/physics.js');
const WORLD = P.WORLD;
const DEG = P.DEG;

function autopilot(st) {
  const input = { rudder: 0, sheet: 0, ballast: 0 };
  const b = WORLD.buoys[Math.min(st.leg, WORLD.buoys.length - 1)];
  let dx = b.x - st.x, dy = b.y - st.y;
  // 礁石规避：对靠近的礁石加排斥向量
  for (const r of WORLD.rocks) {
    const rx = st.x - r.x, ry = st.y - r.y;
    const d = Math.hypot(rx, ry);
    const range = r.r + 170;
    if (d < range && d > 0.01) {
      const wgt = (range - d) / range * 2.4;
      dx += (rx / d) * wgt * 220;
      dy += (ry / d) * wgt * 220;
    }
  }
  const desired = Math.atan2(dy, dx);
  const err = P.wrapAngle(desired - st.heading);
  input.rudder = P.clamp(err * 1.8, -1, 1);
  // 帆角追随最佳值
  const absAwa = Math.abs(st.dbg.awa);
  const optSail = P.clamp(absAwa * 0.5, 6 * DEG, WORLD.boat.sheetMax);
  input.sheet = P.clamp((optSail / WORLD.boat.sheetMax - st.sheet) * 6, -1, 1);
  // 压舱：风大加压，风小排水
  const target = P.clamp((st.dbg.windSpeed - 7) / 6, 0, 1);
  input.ballast = P.clamp((target - st.ballast) * 4, -1, 1);
  return input;
}

let failures = 0;
function check(name, cond, info) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (info ? '  [' + info + ']' : ''));
  if (!ok) failures++;
}

// ---------- 测试 1：完成三段航程 ----------
(function () {
  const st = P.createState();
  const dt = 0.05;
  const buoyLog = [];
  let steps = 0;
  const maxSteps = 1200 / dt; // 最多 20 分钟
  while (!st.finished && !st.capsized && !st.sunk && steps < maxSteps) {
    P.step(st, autopilot(st), dt);
    for (const e of st.events) if (e.type === 'buoy') buoyLog.push(e.leg);
    steps++;
  }
  const t = st.time.toFixed(1);
  check('三段航程完成', st.finished, '用时 ' + t + 's, 剩余船体 ' + st.hull.toFixed(0));
  check('浮标依次通过 1->2->3', buoyLog.join(',') === '1,2,3', buoyLog.join('->'));
  check('航程中未翻覆未沉没', !st.capsized && !st.sunk);
})();

// ---------- 测试 2：空压舱强风横风 => 翻覆 ----------
(function () {
  const st = P.createState();
  st.x = 800; st.y = 430; // 阵风带中心
  st.heading = 135 * DEG; // 西北风下的正横风
  st.ballast = 0;
  st.sheet = 0.5;
  const dt = 0.05;
  let steps = 0;
  let maxHeel = 0;
  while (!st.capsized && steps < 90 / dt) {
    // 保持满受风帆角，不压舱 —— 必然翻覆的错误操作
    const absAwa = Math.abs(st.dbg.awa);
    const optSail = P.clamp(absAwa * 0.5, 6 * DEG, WORLD.boat.sheetMax);
    const input = {
      rudder: 0,
      sheet: P.clamp((optSail / WORLD.boat.sheetMax - st.sheet) * 6, -1, 1),
      ballast: -1
    };
    P.step(st, input, dt);
    maxHeel = Math.max(maxHeel, Math.abs(st.dbg.heelDeg));
    steps++;
  }
  check('空压舱强风横风导致翻覆', st.capsized,
    't=' + st.time.toFixed(1) + 's, 最大横倾 ' + maxHeel.toFixed(1) + '°');
})();

// ---------- 测试 3：满压舱强风横风 => 不翻覆 ----------
(function () {
  const st = P.createState();
  st.x = 800; st.y = 430;
  st.heading = 135 * DEG;
  st.ballast = 1;
  st.sheet = 0.5;
  const dt = 0.05;
  let steps = 0;
  let maxHeel = 0;
  while (steps < 60 / dt) {
    const absAwa = Math.abs(st.dbg.awa);
    const optSail = P.clamp(absAwa * 0.5, 6 * DEG, WORLD.boat.sheetMax);
    P.step(st, {
      rudder: 0,
      sheet: P.clamp((optSail / WORLD.boat.sheetMax - st.sheet) * 6, -1, 1),
      ballast: 1
    }, dt);
    maxHeel = Math.max(maxHeel, Math.abs(st.dbg.heelDeg));
    steps++;
  }
  check('满压舱强风横风保持稳定', !st.capsized, '最大横倾 ' + maxHeel.toFixed(1) + '°');
})();

// ---------- 测试 4：触礁扣船体 ----------
(function () {
  const st = P.createState();
  const rock = WORLD.rocks[5]; // (260, 240)
  st.x = rock.x - 90; st.y = rock.y;
  st.heading = 0; // 正对礁石
  st.sheet = 0.5;
  const dt = 0.05;
  const hullBefore = st.hull;
  let hit = false;
  for (let i = 0; i < 60 / dt && !st.sunk; i++) {
    const absAwa = Math.abs(st.dbg.awa);
    const optSail = P.clamp(absAwa * 0.5, 6 * DEG, WORLD.boat.sheetMax);
    P.step(st, {
      rudder: 0,
      sheet: P.clamp((optSail / WORLD.boat.sheetMax - st.sheet) * 6, -1, 1),
      ballast: 0
    }, dt);
    for (const e of st.events) if (e.type === 'rock') hit = true;
  }
  check('触礁扣船体', hit && st.hull < hullBefore,
    '船体 ' + hullBefore + ' -> ' + st.hull.toFixed(0));
})();

console.log(failures === 0 ? '\n全部测试通过' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);
