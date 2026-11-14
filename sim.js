'use strict';
/*
 * sim.js — 气垫巡检艇泥滩仿真核心（纯逻辑，浏览器与 Node 通用）
 * 坐标系：x 向右，y 向下。海面在北侧（y 小），坡道出口在南侧（y 大）。
 */

const WORLD = {
  W: 1600,
  H: 950,
  exitY: 860,            // y > exitY 为混凝土坡道（安全区）
  tideStartY: 140,       // 任务开始时的潮线位置
  tideHoldUntil: 55,     // 秒：潮位保持期，之后开始回流
  tideSpeed: 13,         // px/s：回流速度
  inspectRadius: 48,     // 巡检有效半径
  dwellTime: 2.2,        // 秒：需在点内低速停留的时长
  skirtMax: 100,
  craftRadius: 16,
};

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 由固定 seed 确定性生成：3 个巡检点、管线、残桩 */
function createWorld(seed) {
  const rng = makeRng(seed);
  const points = [];
  let guard = 0;
  while (points.length < 3 && guard++ < 5000) {
    const p = {
      x: 220 + rng() * (WORLD.W - 440),
      y: 280 + rng() * 400, // 泥滩中部
    };
    if (points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 340)) points.push(p);
  }
  // 管线：从坡道旁的汇管站通往各巡检点（带一个中间弯折）
  const manifold = { x: WORLD.W / 2, y: WORLD.exitY + 30 };
  const pipes = points.map((p) => {
    const mid = {
      x: (p.x + manifold.x) / 2 + (rng() - 0.5) * 160,
      y: (p.y + manifold.y) / 2 + (rng() - 0.5) * 80,
    };
    return { from: manifold, mid, to: p };
  });
  // 残桩：避开巡检点、出生点与出口走廊
  const stumps = [];
  guard = 0;
  while (stumps.length < 26 && guard++ < 8000) {
    const s = {
      x: 60 + rng() * (WORLD.W - 120),
      y: WORLD.tideStartY + 60 + rng() * (WORLD.exitY - WORLD.tideStartY - 120),
      r: 10 + rng() * 8,
    };
    const clearOfPoints = points.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > 110);
    const clearOfSpawn = Math.hypot(800 - s.x, 800 - s.y) > 140;
    if (clearOfPoints && clearOfSpawn) stumps.push(s);
  }
  return { seed, points, pipes, manifold, stumps };
}

function createState(world) {
  return {
    time: 0,
    tideY: WORLD.tideStartY,
    craft: {
      x: WORLD.W / 2, y: 800,
      heading: -Math.PI / 2, // 朝北（向上）
      vx: 0, vy: 0,
      throttle: 0,
    },
    skirt: WORLD.skirtMax,
    hitCooldown: 0,
    inspections: world.points.map(() => ({ progress: 0, done: false })),
    doneCount: 0,
    status: 'running',      // running | won | failed
    failReason: null,       // 'tide' | 'skirt'
    events: [],             // 每帧事件，供音频/HUD 使用
  };
}

/* 泥地阻力随时间变化（阵风/含水量变化），返回值约 0.45 ~ 1.55 */
function mudDrag(state) {
  const t = state.time;
  return 1 + 0.35 * Math.sin(t * 0.35) + 0.2 * Math.sin(t * 0.13 + 1.7);
}

/* 侧向附着系数：阻力越小越滑，侧滑越明显 */
function lateralGrip(state) {
  return 2.2 / mudDrag(state);
}

function skirtFactor(state) {
  return 0.45 + 0.55 * (state.skirt / WORLD.skirtMax);
}

const TURN_RATE = 2.7;      // rad/s
const THRUST = 150;         // px/s^2
const FWD_DRAG = 0.55;      // 1/s 基础纵向阻力
const MAX_SPEED = 320;

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/*
 * input: { turn: -1..1, throttle: 0..1 }
 * 加速时纵向推力沿艇首方向，而速度矢量滞后于转向 → 产生侧滑；
 * 侧向附着力随泥地阻力变化，阻力低时侧滑更明显。
 */
function step(world, state, input, dt) {
  if (state.status !== 'running') return state;
  state.events.length = 0;
  const c = state.craft;
  state.time += dt;
  state.hitCooldown = Math.max(0, state.hitCooldown - dt);

  // 转向（速度越快转向越钝，气垫艇特性）
  const speed = Math.hypot(c.vx, c.vy);
  const turnAuthority = TURN_RATE / (1 + speed / 260);
  c.heading = wrapAngle(c.heading + (input.turn || 0) * turnAuthority * dt);

  // 推力（受底裙完好度影响）
  c.throttle = Math.max(0, Math.min(1, input.throttle || 0));
  const thrust = THRUST * c.throttle * skirtFactor(state);
  let ax = Math.cos(c.heading) * thrust;
  let ay = Math.sin(c.heading) * thrust;

  // 分解速度为纵向/侧向，分别施加阻力 → 侧滑
  const fx = Math.cos(c.heading), fy = Math.sin(c.heading);
  const vFwd = c.vx * fx + c.vy * fy;
  const vLat = -c.vx * fy + c.vy * fx;
  const drag = mudDrag(state);
  const grip = lateralGrip(state);
  const newVFwd = vFwd * Math.max(0, 1 - FWD_DRAG * drag * dt);
  const newVLat = vLat * Math.max(0, 1 - grip * dt);
  c.vx = fx * newVFwd - fy * newVLat + ax * dt;
  c.vy = fy * newVFwd + fx * newVLat + ay * dt;

  const sp = Math.hypot(c.vx, c.vy);
  if (sp > MAX_SPEED) {
    c.vx *= MAX_SPEED / sp;
    c.vy *= MAX_SPEED / sp;
  }
  c.x += c.vx * dt;
  c.y += c.vy * dt;

  // 场地边界
  c.x = Math.max(20, Math.min(WORLD.W - 20, c.x));
  c.y = Math.max(20, Math.min(WORLD.H - 10, c.y));

  // 残桩碰撞：损坏底裙
  for (const s of world.stumps) {
    const d = Math.hypot(c.x - s.x, c.y - s.y);
    const minD = s.r + WORLD.craftRadius;
    if (d < minD) {
      const nx = (c.x - s.x) / (d || 1), ny = (c.y - s.y) / (d || 1);
      c.x = s.x + nx * minD;
      c.y = s.y + ny * minD;
      const impact = Math.hypot(c.vx, c.vy);
      const vn = c.vx * nx + c.vy * ny;
      c.vx -= 1.6 * vn * nx; // 反弹
      c.vy -= 1.6 * vn * ny;
      c.vx *= 0.55; c.vy *= 0.55;
      if (state.hitCooldown <= 0 && impact > 40) {
        const dmg = Math.min(34, 6 + impact * 0.09);
        state.skirt = Math.max(0, state.skirt - dmg);
        state.hitCooldown = 0.6;
        state.events.push({ type: 'hit', damage: dmg });
        if (state.skirt <= 0) {
          state.status = 'failed';
          state.failReason = 'skirt';
          return state;
        }
      }
    }
  }

  // 潮位：保持期后回流（潮线向南推进）
  state.tideY = WORLD.tideStartY +
    WORLD.tideSpeed * Math.max(0, state.time - WORLD.tideHoldUntil);

  const inExit = c.y > WORLD.exitY;
  // 巡检：在半径内低速停留累计进度
  world.points.forEach((p, i) => {
    const insp = state.inspections[i];
    if (insp.done) return;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < WORLD.inspectRadius && Math.hypot(c.vx, c.vy) < 45) {
      insp.progress += dt;
      if (insp.progress >= WORLD.dwellTime) {
        insp.done = true;
        state.doneCount += 1;
        state.events.push({ type: 'inspected', index: i });
      }
    } else {
      insp.progress = Math.max(0, insp.progress - dt * 0.7);
    }
  });

  // 胜利：三点全部巡检并回到坡道
  if (state.doneCount === world.points.length && inExit) {
    state.status = 'won';
    return state;
  }
  // 失败：回流潮水追上艇体（封路），坡道上则安全
  if (!inExit && state.tideY >= c.y - WORLD.craftRadius) {
    state.status = 'failed';
    state.failReason = 'tide';
  }
  return state;
}

/* 简单自动驾驶：朝目标转向、按距离给油，供测试与演示 */
function autopilot(state, target) {
  const c = state.craft;
  const dx = target.x - c.x, dy = target.y - c.y;
  const dist = Math.hypot(dx, dy);
  const desired = Math.atan2(dy, dx);
  const diff = wrapAngle(desired - c.heading);
  const speed = Math.hypot(c.vx, c.vy);
  let throttle = 1;
  if (dist < 130) throttle = Math.max(0, (dist - 30) / 100);
  if (dist < WORLD.inspectRadius && speed > 40) throttle = 0; // 点内减速停留
  if (Math.abs(diff) > 1.2 && speed > 120) throttle = 0.2;    // 大角度先转向
  return { turn: Math.max(-1, Math.min(1, diff * 2.2)), throttle };
}

const API = { WORLD, makeRng, createWorld, createState, mudDrag, lateralGrip, step, autopilot, wrapAngle };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.SIM = API;
